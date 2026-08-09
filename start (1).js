// start.js — WireGuard Panel server
// Stateless design: every generated config's data is encoded into its own
// id (base64url JSON), so no database is needed. Perfect for Railway.

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------
// Server pool — one entry per country. Replace Endpoint values with your
// real server IP:port whenever you rotate keys.
// ---------------------------------------------------------------------
const COUNTRIES = {
  ae: {
    code: "ae",
    flag: "🇦🇪",
    nameEn: "UAE",
    nameFa: "امارات",
    serverTag: "B11",
    privateKey: "aDi30cQATlyFXRlOmLzjK68vQxBe7kDYPisjB8Jg51A=",
    address: "10.109.77.164/32",
    dns: "1.1.1.1, 1.181.121.10",
    publicKey: "3ArEYLg6wR6NYXrg4RTlI4kQmi5iX0z1ERpfKyxSxhk=",
    endpoint: "0.0.0.0:51820"
  },
  ir: {
    code: "ir",
    flag: "🇮🇷",
    nameEn: "Iran",
    nameFa: "ایران",
    serverTag: "B13",
    privateKey: "kNvr1/n8GbdzCdQxqlBeWQUur2XP5wbB0fjmHnwFZUQ=",
    address: "10.39.89.26/32",
    dns: "1.1.1.1, 1.182.102.115",
    publicKey: "aFP5M1M2VUEByYqLt29xyUCmNT2vYXsVGiUG+DSl2Uo=",
    endpoint: "0.0.0.0:51820"
  },
  tr: {
    code: "tr",
    flag: "🇹🇷",
    nameEn: "Turkey",
    nameFa: "ترکیه",
    serverTag: "B12",
    privateKey: "iKhR4GJ5wBstKxjkwUDHkMVUoMUL8lxTmql0iW2JTUE=",
    address: "10.49.101.173/32",
    dns: "1.1.1.1, 1.180.197.251",
    publicKey: "8H3ovcm3xmFxfhmq5jV7aiza4itoynGgOu1tpL7jJEg=",
    endpoint: "0.0.0.0:51820"
  }
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function encodeId(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeId(id) {
  try {
    return JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
}

function sanitizeFilename(name) {
  return (
    String(name || "config")
      .trim()
      .replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, "_")
      .slice(0, 40) || "config"
  );
}

function buildBlock(countryCode, meta) {
  const c = COUNTRIES[countryCode];
  if (!c) return "";
  return [
    "[Interface]",
    `PrivateKey = ${c.privateKey}`,
    `Address = ${c.address}`,
    `DNS = ${c.dns}`,
    `# Name: ${meta.name}`,
    `# Server: ${c.serverTag} ${c.flag} ${c.nameEn}/${c.nameFa}`,
    `# Users: ${meta.users}`,
    `# Volume: ${meta.volume}`,
    `# Expires: ${meta.expireAt}`,
    "# VIP: Active",
    "",
    "[Peer]",
    `PublicKey = ${c.publicKey}`,
    "AllowedIPs = ::/0",
    `Endpoint = ${c.endpoint}`,
    "PersistentKeepalive = 25"
  ].join("\n");
}

function buildFullConfigText(meta) {
  const parts = meta.countries.map((code) => {
    const c = COUNTRIES[code];
    const label = c ? `${c.flag} ${c.nameEn} / ${c.nameFa}` : code;
    return `# ================= ${label} =================\n` + buildBlock(code, meta);
  });
  return parts.join("\n\n");
}

function volumeLabel(volume) {
  if (volume === "unlimited" || volume === 0) return "Unlimited";
  return `${volume}GB`;
}

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

// Create a new config (stateless — data lives inside the returned id)
app.post("/api/generate", (req, res) => {
  const { name, days, users, volume, countries } = req.body || {};

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }
  const daysNum = parseInt(days, 10);
  if (!daysNum || daysNum <= 0 || daysNum > 3650) {
    return res.status(400).json({ error: "invalid days" });
  }
  const usersNum = parseInt(users, 10);
  if (!usersNum || usersNum <= 0 || usersNum > 1000) {
    return res.status(400).json({ error: "invalid users" });
  }
  let volumeVal = volume;
  if (volumeVal !== "unlimited") {
    volumeVal = parseInt(volume, 10);
    if (!volumeVal || volumeVal <= 0) {
      return res.status(400).json({ error: "invalid volume" });
    }
  }
  const countryList = Array.isArray(countries)
    ? countries.filter((c) => COUNTRIES[c])
    : [];
  if (countryList.length === 0) {
    return res.status(400).json({ error: "select at least one country" });
  }

  const createdAt = new Date();
  const expireAt = new Date(createdAt.getTime() + daysNum * 86400000);

  const payload = {
    name: name.trim().slice(0, 60),
    days: daysNum,
    users: usersNum,
    volume: volumeVal,
    volumeLabel: volumeLabel(volumeVal),
    countries: countryList,
    createdAt: createdAt.toISOString(),
    expireAt: expireAt.toISOString()
  };

  const id = encodeId(payload);
  const base = `${req.protocol}://${req.get("host")}`;

  res.json({
    id,
    meta: payload,
    downloadUrl: `${base}/api/config/${id}/download`,
    subUrl: `${base}/sub/${id}`
  });
});

// Fetch meta for an existing id (used to refresh "My Configs" cards)
app.get("/api/config/:id", (req, res) => {
  const meta = decodeId(req.params.id);
  if (!meta) return res.status(404).json({ error: "not found" });
  const base = `${req.protocol}://${req.get("host")}`;
  res.json({
    id: req.params.id,
    meta,
    downloadUrl: `${base}/api/config/${req.params.id}/download`,
    subUrl: `${base}/sub/${req.params.id}`
  });
});

// Download the raw .conf file
app.get("/api/config/:id/download", (req, res) => {
  const meta = decodeId(req.params.id);
  if (!meta) return res.status(404).send("Not found");
  const text = buildFullConfigText(meta);
  const filename = `${sanitizeFilename(meta.name)}.conf`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  );
  res.send(text);
});

// Subscription link content
app.get("/sub/:id", (req, res) => {
  const meta = decodeId(req.params.id);
  if (!meta) return res.status(404).send("Not found");
  const header = [
    `# Name: ${meta.name}`,
    `# Users: ${meta.users}`,
    `# Volume: ${meta.volumeLabel}`,
    `# Created: ${meta.createdAt}`,
    `# Expires: ${meta.expireAt}`,
    `# Servers: ${meta.countries.length}`
  ].join("\n");
  const text = header + "\n\n" + buildFullConfigText(meta);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(text);
});

// List of available countries (for the frontend to render, in case it changes)
app.get("/api/countries", (req, res) => {
  res.json(
    Object.values(COUNTRIES).map((c) => ({
      code: c.code,
      flag: c.flag,
      nameEn: c.nameEn,
      nameFa: c.nameFa
    }))
  );
});

app.listen(PORT, () => {
  console.log(`WireGuard panel running on port ${PORT}`);
});
