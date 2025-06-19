require("dotenv").config();
const express = require("express");
const { InfluxDB, Point } = require("@influxdata/influxdb-client");
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
      "http://142.91.104.5:8086",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// InfluxDB client configuration
const influxDB = new InfluxDB({
  url: process.env.INFLUXDB_URL,
  token: process.env.INFLUXDB_TOKEN,
});

const queryApi = influxDB.getQueryApi(process.env.INFLUXDB_ORG);
const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET;

// Test InfluxDB connection on startup
(async () => {
  try {
    const testQuery = `
      from(bucket: "${INFLUXDB_BUCKET}")
        |> range(start: -1h)
        |> limit(n: 1)
    `;

    const result = await queryApi.collectRows(testQuery);
    console.log("✅ InfluxDB connected successfully");
  } catch (err) {
    console.error("❌ InfluxDB connection failed:", err.message);
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
    // Query meters mapping from InfluxDB
    const query = `
      from(bucket: "${INFLUXDB_BUCKET}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "meters")
        |> filter(fn: (r) => r._field == "room_id")
        |> distinct(column: "meter_mac")
        |> keep(columns: ["meter_mac", "_value"])
        |> rename(columns: {_value: "room_id"})
    `;

    const rows = await queryApi.collectRows(query);
    const macToRoomMap = {};

    rows.forEach((row) => {
      if (row.meter_mac && row.room_id) {
        macToRoomMap[normalizeMacAddress(row.meter_mac)] = row.room_id;
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
    hour: {
      start: localDate.startOf("day").utc().toISOString(),
      stop: localDate.endOf("day").utc().toISOString(),
    },
    // For daily view: cover the entire selected local month
    day: {
      start: localDate.startOf("month").utc().toISOString(),
      stop: localDate.endOf("month").utc().toISOString(),
    },
    // For monthly view: cover the entire selected local year
    month: {
      start: localDate.startOf("year").utc().toISOString(),
      stop: localDate.endOf("year").utc().toISOString(),
    },
    // For yearly view: from start of data to end of selected local year
    year: {
      start: "2023-01-01T00:00:00.000Z", // Adjust based on your actual data start
      stop: localDate.endOf("year").utc().toISOString(),
    },
  };

  return ranges[period] || ranges.hour;
};

// Build InfluxDB query for energy consumption
const buildInfluxQuery = (dateRange, macFilter, timePeriod = null) => {
  let query = `
    from(bucket: "${INFLUXDB_BUCKET}")
      |> range(start: ${dateRange.start}, stop: ${dateRange.stop})
      |> filter(fn: (r) => r._measurement == "pzem")
      |> filter(fn: (r) => r._field == "energy")
  `;

  // Add time period filter if specified
  if (timePeriod) {
    query += `
      |> range(start: ${timePeriod.utcStart}, stop: ${timePeriod.utcEnd})
    `;
  }

  // Add MAC address filter if specified
  if (macFilter && macFilter.length > 0) {
    const macAddresses = macFilter.map((mac) => `"${mac}"`).join(", ");
    query += `
      |> filter(fn: (r) => contains(value: r.mac_address, set: [${macAddresses}]))
    `;
  }

  return query;
};

// Calculate energy consumption from InfluxDB results
const calculateEnergyFromInfluxData = (data, macToRoomMap, room) => {
  let consumptionEnergy = 0;
  let supplyEnergy = 0;

  // Group data by MAC address
  const macGroups = {};
  data.forEach((row) => {
    if (!macGroups[row.mac_address]) {
      macGroups[row.mac_address] = [];
    }
    macGroups[row.mac_address].push(row);
  });

  // Calculate energy delta for each MAC
  Object.entries(macGroups).forEach(([macAddress, readings]) => {
    if (readings.length < 2) return; // Need at least 2 readings to calculate delta

    // Sort by time to get first and last readings
    readings.sort((a, b) => new Date(a._time) - new Date(b._time));
    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];

    const energyDelta = lastReading._value - firstReading._value;
    const normalizedMac = normalizeMacAddress(macAddress);

    if (normalizedMac === SUPPLY_MAC_NORMALIZED) {
      supplyEnergy += energyDelta;
    } else if (room) {
      // If a specific room is requested
      if (
        macToRoomMap.hasOwnProperty(normalizedMac) &&
        macToRoomMap[normalizedMac].toString() === room.toString()
      ) {
        consumptionEnergy += energyDelta;
      }
    } else {
      // For all rooms: only sum MACs that are in meters table
      if (macToRoomMap.hasOwnProperty(normalizedMac)) {
        consumptionEnergy += energyDelta;
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
    hour: {
      unit: "hour",
      format: "HH:00",
      start: localInputDate.startOf("day"),
      end: localInputDate.endOf("day"),
      getValue: (d) => d.hour(),
    },
    day: {
      unit: "day",
      format: "MMM DD",
      start: localInputDate.startOf("month"),
      end: localInputDate.endOf("month"),
      getValue: (d) => d.date(),
    },
    month: {
      unit: "month",
      format: "MMMM",
      start: localInputDate.startOf("year"),
      end: localInputDate.endOf("year"),
      getValue: (d) => d.month(),
    },
    year: {
      unit: "year",
      format: "YYYY",
      start: dayjs.tz("2023-01-01", TIMEZONE),
      end: localInputDate.endOf("year"),
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

// Get energy readings from InfluxDB
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

    // Process periods in batches to avoid overwhelming InfluxDB
    const batchSize = 10;
    for (let i = 0; i < timePeriods.length; i += batchSize) {
      const batch = timePeriods.slice(i, i + batchSize);

      const batchPromises = batch.map(async (timePeriod) => {
        let query = `
          from(bucket: "${INFLUXDB_BUCKET}")
            |> range(start: ${timePeriod.utcStart}, stop: ${timePeriod.utcEnd})
            |> filter(fn: (r) => r._measurement == "pzem")
            |> filter(fn: (r) => r._field == "energy")
        `;

        // Add MAC filter if specified
        if (macFilter && macFilter.length > 0) {
          const macAddresses = macFilter.map((mac) => `"${mac}"`).join(", ");
          query += `
            |> filter(fn: (r) => contains(value: r.mac_address, set: [${macAddresses}]))
          `;
        }

        query += `
          |> sort(columns: ["_time"])
        `;

        const data = await queryApi.collectRows(query);

        const energy =
          data.length > 0
            ? calculateEnergyFromInfluxData(data, macToRoomMap, room)
            : { consumption: 0, supply: 0 };

        return {
          timestamp: timePeriod.timestamp,
          fullTimestamp: timePeriod.fullTimestamp,
          period: timePeriod.period,
          utcStart: timePeriod.utcStart,
          utcEnd: timePeriod.utcEnd,
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

// Rooms endpoint
app.get("/api/rooms", async (req, res) => {
  try {
    const query = `
      from(bucket: "${INFLUXDB_BUCKET}")
        |> range(start: 0)
        |> filter(fn: (r) => r._measurement == "meters")
        |> filter(fn: (r) => r._field == "room_id")
        |> distinct(column: "_value")
        |> sort(columns: ["_value"])
    `;

    const rows = await queryApi.collectRows(query);
    const rooms = rows.map((row) => row._value).sort((a, b) => a - b);

    res.json({ rooms });
  } catch (error) {
    console.error("❌ Error fetching rooms:", error.message);
    res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// Main API endpoint
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

    // Build MAC filter for room
    let macFilter = [];
    if (room) {
      const macsForRoom = Object.entries(macToRoomMap)
        .filter(([mac, roomId]) => roomId.toString() === room.toString())
        .map(([mac]) => mac);

      if (macsForRoom.length) {
        macFilter = macsForRoom;
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
