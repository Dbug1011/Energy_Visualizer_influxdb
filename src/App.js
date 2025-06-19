"use client";

import { useEffect, useState, useCallback } from "react";
import EnergyChart from "./components/EnergyChart";
import dayjs from "dayjs";

const DatePicker = ({ selected, onChange, dateFormat, className }) => {
  const formatDate = (date) => {
    return date.toISOString().split("T")[0];
  };

  return (
    <input
      type="date"
      value={selected ? formatDate(selected) : ""}
      onChange={(e) => onChange(new Date(e.target.value))}
      className={className}
      style={{
        padding: "8px 12px",
        border: "1px solid rgba(16, 185, 129, 0.3)",
        borderRadius: "6px",
        fontSize: "14px",
        background: "rgba(255, 255, 255, 0.8)",
        backdropFilter: "blur(10px)",
        outline: "none",
      }}
      onFocus={(e) => {
        e.target.style.borderColor = "#10b981";
        e.target.style.boxShadow = "0 0 0 2px rgba(16, 185, 129, 0.2)";
      }}
      onBlur={(e) => {
        e.target.style.borderColor = "rgba(16, 185, 129, 0.3)";
        e.target.style.boxShadow = "none";
      }}
    />
  );
};

const App = () => {
  const [data, setData] = useState([]);
  const [period, setPeriod] = useState("hour");
  const [room, setRoom] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [serverStatus, setServerStatus] = useState("unknown");
  const [availableRooms, setAvailableRooms] = useState([]);
  const [showSupply, setShowSupply] = useState(true);

  const testServerConnection = useCallback(async () => {
    const servers = [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://142.91.104.5:3001",
    ];

    for (const server of servers) {
      try {
        console.log(`Testing server: ${server}`);
        const response = await fetch(`${server}/api/health`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const healthData = await response.json();
          console.log(`✅ Server ${server} is accessible:`, healthData);
          setServerStatus(server);
          return server;
        }
      } catch (err) {
        console.warn(`❌ Server ${server} not accessible:`, err.message);
      }
    }
    setServerStatus("Error: No server accessible.");
    return null;
  }, []);

  const fetchRooms = useCallback(async (workingServer) => {
    if (!workingServer) return;
    try {
      const response = await fetch(`${workingServer}/api/rooms`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch rooms: ${response.statusText}`);
      }
      const data = await response.json();
      setAvailableRooms(data.rooms.sort((a, b) => a - b));
      console.log("Fetched rooms:", data.rooms);
    } catch (err) {
      console.error("Error fetching rooms:", err);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const workingServer = await testServerConnection();
      if (!workingServer) {
        setLoading(false);
        return;
      }

      if (availableRooms.length === 0) {
        await fetchRooms(workingServer);
      }

      const params = new URLSearchParams({
        period,
        date: selectedDate.toISOString().split("T")[0],
      });
      if (room) {
        params.append("room", room);
      }

      console.log(`📡 Fetching data from: ${workingServer}/api/data?${params}`);

      const response = await fetch(`${workingServer}/api/data?${params}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Server error (${response.status}): ${
            errorData.error || response.statusText || "Unknown error"
          }`
        );
      }

      const responseData = await response.json();
      console.log("📊 Raw API response:", responseData);

      let apiData = responseData;
      if (responseData.data) {
        apiData = responseData.data;
      }

      if (!Array.isArray(apiData)) {
        throw new Error("Invalid response format: expected array of data");
      }

      if (apiData.length === 0) {
        console.warn("⚠️ No data returned from API");
        setError("No data available for the selected criteria.");
        setData([]);
        return;
      }

      const mappedData = apiData.map((item) => {
        const dateObject = new Date(item.fullTimestamp);

        let formattedTimestamp;

        if (period === "hour") {
          formattedTimestamp = `${item.period.toString().padStart(2, "0")}:00`;
        } else if (period === "day") {
          formattedTimestamp = dayjs(dateObject).format("MMM DD");
        } else if (period === "month") {
          formattedTimestamp = dayjs(dateObject).format("MMMM");
        } else if (period === "year") {
          formattedTimestamp = dayjs(dateObject).format("YYYY");
        } else {
          formattedTimestamp = dayjs(dateObject).format();
        }

        return {
          timestamp: formattedTimestamp,
          fullTimestamp: dateObject,
          period: item.period,
          consumption: Number.parseFloat(item.consumption) || 0,
          supply: Number.parseFloat(item.supply) || 0,
        };
      });

      console.log("✅ Processed data:", mappedData);

      function generateAllPeriods(period, selectedDate) {
        const periods = [];
        const d = dayjs(selectedDate);

        if (period === "day") {
          const daysInMonth = d.daysInMonth();
          for (let i = 1; i <= daysInMonth; i++) {
            periods.push({
              timestamp: dayjs(d).date(i).format("MMM DD"),
              period: i,
            });
          }
        } else if (period === "month") {
          for (let i = 0; i < 12; i++) {
            periods.push({
              timestamp: dayjs().month(i).format("MMMM"),
              period: i,
            });
          }
        } else if (period === "year") {
          // FIX: Add this block to handle the year period
          const startYear = 2023; // The earliest year of your data
          const endYear = d.year(); // The year from the date picker
          for (let y = startYear; y <= endYear; y++) {
            periods.push({
              timestamp: y.toString(),
              period: y,
            });
          }
        }
        return periods;
      }

      let filledData = mappedData;

      if (["day", "month", "year"].includes(period)) {
        const allPeriods = generateAllPeriods(period, selectedDate);
        filledData = allPeriods.map((p) => {
          const found = mappedData.find((d) => d.timestamp === p.timestamp);
          return found
            ? found
            : {
                ...p,
                consumption: 0,
                supply: 0,
              };
        });
      }

      setData(filledData);
    } catch (err) {
      console.error("❌ Failed to fetch data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [
    period,
    room,
    selectedDate,
    availableRooms.length,
    fetchRooms,
    testServerConnection,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const initApp = async () => {
      const server = await testServerConnection();
      if (server) {
        await fetchRooms(server);
      }
    };
    initApp();
  }, [testServerConnection, fetchRooms]);

  return (
    <>
      {/* Full Window Background */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: `
            linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 25%, #ecfdf5 50%, #fef3c7 75%, #f0f9ff 100%),
            radial-gradient(circle at 25% 25%, rgba(255, 255, 255, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, rgba(16, 185, 129, 0.1) 0%, transparent 50%)
          `,
          backgroundSize: "400% 400%, 800px 800px, 600px 600px",
          animation: "gradientShift 20s ease infinite",
          zIndex: -2,
        }}
      />

      {/* Animated Pattern Overlay */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundImage: `
            radial-gradient(circle at 20% 80%, rgba(16, 185, 129, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(255, 107, 53, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 40% 40%, rgba(59, 130, 246, 0.06) 0%, transparent 50%),
            linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.03) 50%, transparent 70%)
          `,
          backgroundSize: "600px 600px, 800px 800px, 400px 400px, 200px 200px",
          animation: "float 25s ease-in-out infinite",
          zIndex: -1,
        }}
      />

      {/* Main Content */}
      <div
        style={{
          position: "relative",
          padding: "16px",
          maxWidth: "1200px",
          margin: "0 auto",
          fontFamily: "Arial, sans-serif",
          minHeight: "100vh",
          zIndex: 1,
        }}
      >
        {/* Header */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "20px",
          }}
        >
          <h1
            style={{
              fontSize: "24px",
              fontWeight: "600",
              color: "#111827",
              margin: "0 0 8px 0",
            }}
          >
            Electricity Dashboard
          </h1>

          {/* Server Status */}
          <div
            style={{
              fontSize: "12px",
              color: serverStatus.includes("Error") ? "#dc2626" : "#10b981",
              fontWeight: "500",
            }}
          >
            {serverStatus === "unknown"
              ? "Connecting..."
              : serverStatus.includes("Error")
              ? "Server connection failed"
              : `Connected to ${serverStatus.split("//")[1]}`}
          </div>
        </div>

        {/* Unified Control Panel */}
        <div
          style={{
            marginBottom: "20px",
            padding: "20px",
            background:
              "linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.2) 100%)",
            backdropFilter: "blur(15px)",
            borderRadius: "12px",
            border: "1px solid rgba(255, 255, 255, 0.5)",
            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr",
              gap: "20px",
              alignItems: "end",
            }}
          >
            {/* Period Selection */}
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                }}
              >
                Period:
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                {["hour", "day", "month", "year"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "6px",
                      border: "none",
                      background:
                        period === p
                          ? "linear-gradient(135deg, #10b981 0%, #059669 100%)"
                          : "rgba(255, 255, 255, 0.7)",
                      color: period === p ? "#ffffff" : "#374151",
                      cursor: "pointer",
                      fontWeight: "500",
                      fontSize: "13px",
                      textTransform: "capitalize",
                      transition: "all 0.2s ease",
                      boxShadow:
                        period === p
                          ? "0 2px 8px rgba(16, 185, 129, 0.3)"
                          : "0 1px 3px rgba(0, 0, 0, 0.1)",
                      backdropFilter: "blur(10px)",
                      flex: 1,
                    }}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Room Selection */}
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                }}
              >
                Room:
              </label>
              <select
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                style={{
                  padding: "8px 12px",
                  border: "1px solid rgba(255, 255, 255, 0.6)",
                  borderRadius: "6px",
                  fontSize: "14px",
                  background: "rgba(255, 255, 255, 0.7)",
                  backdropFilter: "blur(10px)",
                  outline: "none",
                  width: "100%",
                  color: "#374151",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#10b981";
                  e.target.style.boxShadow =
                    "0 0 0 2px rgba(16, 185, 129, 0.2)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(255, 255, 255, 0.6)";
                  e.target.style.boxShadow = "none";
                }}
              >
                <option value="">All Rooms</option>
                {availableRooms.map((r) => (
                  <option key={r} value={r}>
                    Room {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Selection */}
            <div>
              <label
                style={{
                  display: "block",
                  marginBottom: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  color: "#374151",
                }}
              >
                Date:
              </label>
              <DatePicker
                selected={selectedDate}
                onChange={(date) => setSelectedDate(date)}
                dateFormat="yyyy-MM-dd"
                className="date-picker"
              />
            </div>

            {/* Refresh Button */}
            <div>
              <button
                onClick={fetchData}
                disabled={loading}
                style={{
                  padding: "8px 16px",
                  background: loading
                    ? "rgba(156, 163, 175, 0.8)"
                    : "linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                  width: "100%",
                  height: "36px",
                  transition: "all 0.2s ease",
                  boxShadow: loading
                    ? "none"
                    : "0 2px 8px rgba(255, 107, 53, 0.3)",
                  backdropFilter: "blur(10px)",
                }}
              >
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        {loading ? (
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.2) 100%)",
              backdropFilter: "blur(15px)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.5)",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
              padding: "40px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                border: "3px solid rgba(16, 185, 129, 0.3)",
                borderTop: "3px solid #10b981",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <div
              style={{
                fontSize: "16px",
                color: "#374151",
                marginBottom: "8px",
              }}
            >
              Loading data...
            </div>
            <div style={{ fontSize: "12px", color: "#6b7280" }}>
              Testing server connections and fetching data
            </div>
          </div>
        ) : error ? (
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(254, 242, 242, 0.8) 0%, rgba(220, 38, 38, 0.1) 100%)",
              backdropFilter: "blur(15px)",
              border: "1px solid rgba(220, 38, 38, 0.3)",
              borderRadius: "12px",
              padding: "20px",
              textAlign: "center",
              boxShadow: "0 4px 20px rgba(220, 38, 38, 0.1)",
            }}
          >
            <div
              style={{
                fontSize: "14px",
                fontWeight: "500",
                color: "#dc2626",
                marginBottom: "4px",
              }}
            >
              Error Loading Data
            </div>
            <div style={{ fontSize: "12px", color: "#991b1b" }}>{error}</div>
          </div>
        ) : (
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.2) 100%)",
              backdropFilter: "blur(15px)",
              borderRadius: "12px",
              border: "1px solid rgba(255, 255, 255, 0.5)",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
            }}
          >
            {data.length > 0 ? (
              <>
                {/* Chart Header */}
                <div
                  style={{
                    padding: "16px 20px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: "600",
                      color: "#111827",
                      marginBottom: "8px",
                      textAlign: "center",
                    }}
                  >
                    {room
                      ? `Room ${room} Energy Consumption (kWh)`
                      : "All Rooms Consumption vs Grid Supply (kWh)"}
                  </div>

                  {/* Supply Toggle */}
                  <div style={{ textAlign: "center" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "13px",
                        fontWeight: "500",
                        color: room === "" ? "#374151" : "#6b7280",
                        cursor: room === "" ? "pointer" : "not-allowed",
                        padding: "4px 8px",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showSupply}
                        onChange={() => setShowSupply((prev) => !prev)}
                        disabled={room !== ""}
                        style={{
                          cursor: room === "" ? "pointer" : "not-allowed",
                          accentColor: "#10b981",
                        }}
                      />
                      Show Grid Supply
                      {room !== "" && (
                        <span
                          style={{
                            fontSize: "11px",
                            color: "#6b7280",
                            fontStyle: "italic",
                          }}
                        >
                          (All Rooms only)
                        </span>
                      )}
                    </label>
                  </div>
                </div>

                {/* Chart */}
                <div style={{ padding: "16px" }}>
                  <EnergyChart
                    data={data}
                    showSupply={room === "" && showSupply}
                  />
                </div>
              </>
            ) : (
              <div
                style={{
                  padding: "40px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "14px",
                    color: "#374151",
                    marginBottom: "4px",
                  }}
                >
                  No Data Available
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  No data found for the selected criteria
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes gradientShift {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        @keyframes float {
          0%,
          100% {
            transform: translateY(0px) rotate(0deg);
          }
          33% {
            transform: translateY(-8px) rotate(0.5deg);
          }
          66% {
            transform: translateY(4px) rotate(-0.5deg);
          }
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </>
  );
};

export default App;
