import {
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const consumption =
      payload.find((p) => p.dataKey === "consumption")?.value ?? 0;
    const supply = payload.find((p) => p.dataKey === "supply")?.value ?? 0;

    // Check if supply data exists to determine if we should show grid and loss
    const hasSupplyData = payload.some(
      (p) => p.dataKey === "supply" && p.value !== null && p.value !== undefined
    );

    return (
      <div
        className="custom-tooltip"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(15px)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
          padding: "16px",
          borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.15)",
          minWidth: "200px",
        }}
      >
        <p
          style={{
            fontSize: "14px",
            fontWeight: "600",
            color: "#374151",
            marginBottom: "12px",
            borderBottom: "1px solid rgba(243, 244, 246, 0.8)",
            paddingBottom: "8px",
          }}
        >
          {label}
        </p>

        {/* Grid Supply First */}
        {hasSupplyData && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                }}
              ></div>
              <span style={{ color: "#6b7280", fontSize: "13px" }}>
                Grid Supply
              </span>
            </div>
            <span
              style={{ color: "#374151", fontSize: "13px", fontWeight: "600" }}
            >
              {supply} kWh
            </span>
          </div>
        )}

        {/* Consumption Second */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: hasSupplyData ? "12px" : "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #ff6b35, #f7931e)",
              }}
            ></div>
            <span style={{ color: "#6b7280", fontSize: "13px" }}>
              Consumption
            </span>
          </div>
          <span
            style={{ color: "#374151", fontSize: "13px", fontWeight: "600" }}
          >
            {consumption} kWh
          </span>
        </div>

        {/* Loss Calculation */}
        {hasSupplyData && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "8px",
              borderTop: "1px solid rgba(243, 244, 246, 0.8)",
            }}
          >
            <span
              style={{ color: "#374151", fontSize: "13px", fontWeight: "600" }}
            >
              Loss
            </span>
            <span
              style={{
                color: "#dc2626",
                fontSize: "13px",
                fontWeight: "700",
                background: "rgba(220, 38, 38, 0.1)",
                padding: "2px 6px",
                borderRadius: "4px",
              }}
            >
              {(supply - consumption).toFixed(3)} kWh
            </span>
          </div>
        )}
      </div>
    );
  }
  return null;
};

const EnergyChart = ({ data, showSupply }) => {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "400px",
          background: "transparent",
          backdropFilter: "none",
          borderRadius: "16px",
          border: "none",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            background: "transparent",
            backdropFilter: "none",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
            border: "none",
          }}
        >
          <svg
            width="32"
            height="32"
            fill="none"
            stroke="#64748b"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        </div>
        <p
          style={{
            fontSize: "18px",
            fontWeight: "600",
            color: "#64748b",
            marginBottom: "8px",
          }}
        >
          No data available
        </p>
        <p style={{ fontSize: "14px", color: "#94a3b8" }}>
          Energy data will appear here when available
        </p>
      </div>
    );
  }

  // Check if supply data exists (only for "All Rooms" view)
  const hasSupplyData = data.some(
    (item) => item.supply !== null && item.supply !== undefined
  );

  return (
    <div
      style={{
        width: "100%",
        background: "transparent",
        borderRadius: "16px",
        border: "none",
        boxShadow: "none",
        overflow: "hidden",
      }}
    >
      {/* Chart */}
      <div style={{ padding: "24px" }}>
        <div style={{ width: "100%", height: 400 }}>
          <ResponsiveContainer>
            <AreaChart
              data={data}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <defs>
                <linearGradient
                  id="consumptionGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#ff6b35" stopOpacity={0.3} />
                  <stop offset="50%" stopColor="#f7931e" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#ff6b35" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="supplyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="50%" stopColor="#059669" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#f1f5f9"
                strokeWidth={1}
                opacity={0.7}
              />

              <XAxis
                dataKey="timestamp"
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                tickLine={{ stroke: "#cbd5e1" }}
                axisLine={{ stroke: "#cbd5e1" }}
              />

              <YAxis
                tick={{ fontSize: 12, fill: "#64748b" }}
                stroke="#cbd5e1"
                tickLine={{ stroke: "#cbd5e1" }}
                axisLine={{ stroke: "#cbd5e1" }}
                label={{
                  value: "Energy (kWh)",
                  angle: -90,
                  position: "insideLeft",
                  style: {
                    textAnchor: "middle",
                    fill: "#64748b",
                    fontSize: 14,
                  },
                }}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={{
                  stroke: "#e2e8f0",
                  strokeWidth: 2,
                  strokeDasharray: "5 5",
                }}
              />

              <Legend
                wrapperStyle={{
                  paddingTop: "20px",
                  fontSize: "14px",
                }}
                iconType="circle"
              />

              {showSupply && hasSupplyData && (
                <Area
                  type="monotone"
                  dataKey="supply"
                  stroke="#10b981"
                  strokeWidth={3}
                  fill="url(#supplyGradient)"
                  name="Grid Supply (kWh)"
                  dot={false}
                  activeDot={{
                    r: 6,
                    fill: "#10b981",
                    stroke: "#ffffff",
                    strokeWidth: 3,
                    filter: "drop-shadow(0 2px 4px rgba(16, 185, 129, 0.4))",
                  }}
                />
              )}

              <Area
                type="monotone"
                dataKey="consumption"
                stroke="#ff6b35"
                strokeWidth={3}
                fill="url(#consumptionGradient)"
                name="Consumption (kWh)"
                dot={false}
                activeDot={{
                  r: 6,
                  fill: "#ff6b35",
                  stroke: "#ffffff",
                  strokeWidth: 3,
                  filter: "drop-shadow(0 2px 4px rgba(255, 107, 53, 0.4))",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default EnergyChart;
