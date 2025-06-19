require("dotenv").config();
const express = require("express");
const { Client } = require("@elastic/elasticsearch");
const cors = require("cors");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration constants
const TIMEZONE = "Asia/Shanghai"; // UTC+8
const SUPPLY_MAC_NORMALIZED = "08:f9:e0:73:64:db";

// CORS configuration
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
      "http://142.91.104.5:3000",
      "http://142.91.104.5:3001",
      "http://142.91.104.5",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// Elasticsearch client with connection pooling
const esClient = new Client({
  node: process.env.ES_NODE || "http://localhost:9200",
  auth: {
    username: process.env.ES_USERNAME,
    password: process.env.ES_PASSWORD,
  },
  compatibilityHeader: false,
  maxRetries: 3,
  requestTimeout: 30000,
  sniffOnStart: true,
});

// Test Elasticsearch connection on startup
(async () => {
  try {
    const health = await esClient.cluster.health();
    console.log("✅ Elasticsearch connected successfully", health.status);
  } catch (err) {
    console.error("❌ Elasticsearch connection failed:", err.message);
  }
})();

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is healthy" });
});

// Helper functions
const normalizeMacAddress = (mac) => mac.toLowerCase();

// Cache for meters mapping to avoid repeated queries
let metersCache = null;
let cacheTimestamp = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const getMetersMapping = async () => {
  const now = Date.now();

  // Return cached data if still valid
  if (metersCache && cacheTimestamp && now - cacheTimestamp < CACHE_DURATION) {
    return metersCache;
  }

  try {
    const response = await esClient.search({
      index: "meters_idx",
      timeout: "30s",
      body: {
        query: { match_all: {} },
        size: 10000,
        _source: ["meter_mac", "room_id"],
      },
    });

    const macToRoomMap = {};
    response.hits.hits.forEach((hit) => {
      const { meter_mac, room_id } = hit._source;
      if (meter_mac && room_id) {
        macToRoomMap[normalizeMacAddress(meter_mac)] = room_id;
      }
    });

    // Update cache
    metersCache = macToRoomMap;
    cacheTimestamp = now;

    return macToRoomMap;
  } catch (error) {
    console.error("❌ Error fetching meters mapping:", error.message);
    return metersCache || {}; // Return cached data if available, otherwise empty object
  }
};

// Optimized date range builder - converts local periods to UTC ranges
const buildDateRangeQuery = (period, date) => {
  // Parse the input date as local time (UTC+8)
  const localDate = dayjs.tz(date, TIMEZONE);

  const ranges = {
    // For hourly view: cover the entire selected local day
    // Local day 2025-06-16 00:00 to 23:59 = UTC 2025-06-15 16:00 to 2025-06-16 15:59
    hour: {
      gte: localDate.startOf("day").utc().toISOString(),
      lte: localDate.endOf("day").utc().toISOString(),
    },
    // For daily view: cover the entire selected local month
    // Local month June 2025 = UTC 2025-05-31 16:00 to 2025-06-30 15:59
    day: {
      gte: localDate.startOf("month").utc().toISOString(),
      lte: localDate.endOf("month").utc().toISOString(),
    },
    // For monthly view: cover the entire selected local year
    // Local year 2025 = UTC 2024-12-31 16:00 to 2025-12-31 15:59
    month: {
      gte: localDate.startOf("year").utc().toISOString(),
      lte: localDate.endOf("year").utc().toISOString(),
    },
    // For yearly view: from start of data to end of selected local year
    year: {
      gte: "2023-01-01T00:00:00.000Z", // Adjust based on your actual data start
      lte: localDate.endOf("year").utc().toISOString(),
    },
  };

  return ranges[period] || ranges.hour;
};

// Generic function to build Elasticsearch query
const buildEsQuery = (dateRange, macFilter) => ({
  query: {
    bool: {
      filter: [{ range: { log_datetime: dateRange } }, ...macFilter],
    },
  },
  aggs: {
    by_mac: {
      terms: {
        field: "mac_address.keyword",
        size: 1000,
      },
      aggs: {
        first_energy: {
          top_hits: {
            sort: [{ log_datetime: { order: "asc" } }],
            _source: ["energy", "log_datetime"],
            size: 1,
          },
        },
        last_energy: {
          top_hits: {
            sort: [{ log_datetime: { order: "desc" } }],
            _source: ["energy", "log_datetime"],
            size: 1,
          },
        },
      },
    },
  },
  size: 0,
});

// Update: Only sum consumption for MACs in meters table (rooms 1-16), exclude others for "all rooms"
const calculateEnergyFromBuckets = (buckets, macToRoomMap, room) => {
  let consumptionEnergy = 0;
  let supplyEnergy = 0;

  buckets.forEach((macBucket) => {
    const macAddress = macBucket.key;
    const normalizedMac = normalizeMacAddress(macAddress);
    const firstReading = macBucket.first_energy.hits.hits[0];
    const lastReading = macBucket.last_energy.hits.hits[0];

    if (firstReading && lastReading) {
      const energyDelta =
        lastReading._source.energy - firstReading._source.energy;

      if (normalizedMac === SUPPLY_MAC_NORMALIZED) {
        supplyEnergy += energyDelta;
      } else if (room) {
        // If a specific room is requested, keep original logic
        if (
          macToRoomMap.hasOwnProperty(normalizedMac) &&
          macToRoomMap[normalizedMac].toString() === room.toString()
        ) {
          consumptionEnergy += energyDelta;
        }
      } else {
        // For all rooms: only sum MACs that are in meters table (rooms 1-16)
        if (macToRoomMap.hasOwnProperty(normalizedMac)) {
          consumptionEnergy += energyDelta;
        }
      }
    }
  });

  return {
    consumption: Math.max(0, parseFloat(consumptionEnergy.toFixed(3))),
    supply: Math.max(0, parseFloat(supplyEnergy.toFixed(3))),
  };
};

// Generic function to get time periods - properly handles local to UTC conversion
const getTimePeriods = (period, dateRange, inputDate) => {
  const periods = [];
  const localInputDate = dayjs.tz(inputDate, TIMEZONE);

  const configs = {
    // For hourly: iterate through each hour of the selected local day
    // Example: 2025-06-16 input -> hours 00:00, 01:00, ..., 23:00 in local time
    hour: {
      unit: "hour",
      format: "HH:00",
      start: localInputDate.startOf("day"), // 2025-06-16 00:00:00 +08:00
      end: localInputDate.endOf("day"), // 2025-06-16 23:59:59 +08:00
      getValue: (d) => d.hour(),
    },
    // For daily: iterate through each day of the selected local month
    // Example: 2025-06-16 input -> days 1, 2, ..., 30 of June 2025
    day: {
      unit: "day",
      format: "MMM DD",
      start: localInputDate.startOf("month"), // 2025-06-01 00:00:00 +08:00
      end: localInputDate.endOf("month"), // 2025-06-30 23:59:59 +08:00
      getValue: (d) => d.date(),
    },
    // For monthly: iterate through each month of the selected local year
    // Example: 2025-06-16 input -> months Jan, Feb, ..., Dec of 2025
    month: {
      unit: "month",
      format: "MMMM",
      start: localInputDate.startOf("year"), // 2025-01-01 00:00:00 +08:00
      end: localInputDate.endOf("year"), // 2025-12-31 23:59:59 +08:00
      getValue: (d) => d.month(),
    },
    // For yearly: iterate through years from data start to selected year
    year: {
      unit: "year",
      format: "YYYY",
      start: dayjs.tz("2023-01-01", TIMEZONE), // Adjust based on your data start
      end: localInputDate.endOf("year"), // 2025-12-31 23:59:59 +08:00
      getValue: (d) => d.year(),
    },
  };

  const config = configs[period];
  if (!config) return periods;

  let current = config.start;

  while (
    current.isBefore(config.end) ||
    current.isSame(config.end, config.unit)
  ) {
    // Convert local time period to UTC for Elasticsearch query
    const utcStart = current.startOf(config.unit).utc().toISOString();
    const utcEnd = current.endOf(config.unit).utc().toISOString();

    periods.push({
      local: current,
      utcStart,
      utcEnd,
      timestamp: current.format(config.format),
      fullTimestamp: current.toDate(),
      period: config.getValue(current),
    });

    current = current.add(1, config.unit);
  }

  return periods;
};

// Update: Pass macToRoomMap and room to calculateEnergyFromBuckets in getEnergyReadings
const getEnergyReadings = async (
  period,
  dateRange,
  macFilter,
  inputDate,
  macToRoomMap,
  room
) => {
  try {
    const timePeriods = getTimePeriods(period, dateRange, inputDate);
    const results = [];

    // Process periods in batches to avoid overwhelming Elasticsearch
    const batchSize = 10;
    for (let i = 0; i < timePeriods.length; i += batchSize) {
      const batch = timePeriods.slice(i, i + batchSize);

      const batchPromises = batch.map(async (timePeriod) => {
        const periodRange = {
          gte: timePeriod.utcStart,
          lte: timePeriod.utcEnd,
        };

        const query = buildEsQuery(periodRange, macFilter);
        const response = await esClient.search({
          index: "pzem_idx",
          body: query,
        });

        const energy = response.aggregations?.by_mac?.buckets?.length
          ? calculateEnergyFromBuckets(
              response.aggregations.by_mac.buckets,
              macToRoomMap,
              room
            )
          : { consumption: 0, supply: 0 };

        return {
          timestamp: timePeriod.timestamp,
          fullTimestamp: timePeriod.fullTimestamp,
          period: timePeriod.period,
          utcStart: timePeriod.utcStart, // Include for debugging
          utcEnd: timePeriod.utcEnd, // Include for debugging
          ...energy,
        };
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results.sort((a, b) => a.period - b.period);
  } catch (error) {
    console.error(
      `❌ Error in getEnergyReadings for ${period}:`,
      error.message
    );
    throw error;
  }
};

// Rooms endpoint with caching
app.get("/api/rooms", async (req, res) => {
  try {
    const response = await esClient.search({
      index: "meters_idx",
      timeout: "30s",
      body: {
        aggs: {
          unique_rooms: {
            terms: {
              field: "room_id",
              size: 1000,
            },
          },
        },
        size: 0,
      },
    });

    const rooms = response.aggregations.unique_rooms.buckets
      .map((bucket) => bucket.key)
      .sort((a, b) => a - b);

    res.json({ rooms });
  } catch (error) {
    console.error("❌ Error fetching rooms:", error.message);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Main API endpoint - pass macToRoomMap and room to getEnergyReadings
app.get("/api/data", async (req, res) => {
  console.log("📥 Received request for energy data:", req.query);

  try {
    const {
      period = "hour",
      room,
      date = dayjs().tz(TIMEZONE).format("YYYY-MM-DD"),
    } = req.query;

    // Validate inputs
    if (!["hour", "day", "month", "year"].includes(period)) {
      return res
        .status(400)
        .json({ error: "Invalid period. Use: hour, day, month, or year" });
    }

    if (!dayjs(date).isValid()) {
      return res
        .status(400)
        .json({ error: "Invalid date format. Use YYYY-MM-DD." });
    }

    // Get meters mapping
    const macToRoomMap = await getMetersMapping();
    const dateRange = buildDateRangeQuery(period, date);

    // Build MAC filter for room (do not change this logic)
    let macFilter = [];
    if (room) {
      const macsForRoom = Object.entries(macToRoomMap)
        .filter(([mac, roomId]) => roomId.toString() === room.toString())
        .map(([mac]) => mac);

      if (macsForRoom.length) {
        macFilter = [{ terms: { "mac_address.keyword": macsForRoom } }];
      } else {
        return res.json({
          data: [],
          message: "No meters found for the selected room.",
        });
      }
    }

    // Get energy readings
    const result = await getEnergyReadings(
      period,
      dateRange,
      macFilter,
      date,
      macToRoomMap,
      room
    );

    res.json({
      data: result,
      meta: {
        period,
        room,
        date,
        timezone: TIMEZONE,
        totalRecords: result.length,
      },
    });
  } catch (error) {
    console.error("❌ API /api/data error:", error.message);
    res.status(500).json({
      error: "API request failed",
      details: error.message,
    });
  }
});

// Start server
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Process terminated");
  });
});
