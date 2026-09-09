require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = Number(process.env.PORT || 3000);

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI missing in .env");
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET missing in .env");
  process.exit(1);
}

app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

/* =========================================================
   DATABASE
========================================================= */

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30
    },

    passwordHash: {
      type: String,
      required: true
    },

    balance: {
      type: Number,
      default: 0,
      min: 0
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { versionKey: false }
);

const betSchema = new mongoose.Schema(
  {
    roundId: {
      type: Number,
      required: true
    },

    username: {
      type: String,
      required: true
    },

    side: {
      type: String,
      enum: ["HEADS", "TAILS"],
      required: true
    },

    amount: {
      type: Number,
      required: true,
      min: 1
    },

    result: {
      type: String,
      enum: ["PENDING", "WIN", "LOSS"],
      default: "PENDING"
    },

    payout: {
      type: Number,
      default: 0
    },

    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  { versionKey: false }
);

betSchema.index(
  {
    roundId: 1,
    username: 1
  },
  {
    unique: true
  }
);

const roundSchema = new mongoose.Schema(
  {
    roundId: {
      type: Number,
      unique: true
    },

    heads: {
      type: Number,
      default: 0
    },

    tails: {
      type: Number,
      default: 0
    },

    result: {
      type: String,
      enum: ["HEADS", "TAILS", null],
      default: null
    },

    startedAt: Date,
    endedAt: Date
  },
  { versionKey: false }
);

const User = mongoose.model("User", userSchema);
const Bet = mongoose.model("Bet", betSchema);
const Round = mongoose.model("Round", roundSchema);

/* =========================================================
   GAME STATE
========================================================= */

const ROUND_LENGTH = 30_000;
const BETTING_LENGTH = 27_000;

let roundId = 1;
let roundStartedAt = Date.now();
let roundPhase = "BETTING";
let currentResult = null;

let forceMode = "AUTO";

const recentResults = [];

const onlineUsers = new Set();

let gameTimer = null;

/* =========================================================
   HELPERS
========================================================= */

function cleanUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
}

function cleanSide(value) {
  const side = String(value || "").toUpperCase();

  if (side !== "HEADS" && side !== "TAILS") {
    return null;
  }

  return side;
}

function publicState() {
  const elapsed = Date.now() - roundStartedAt;

  return {
    roundId,
    phase: roundPhase,
    remainingMs: Math.max(0, ROUND_LENGTH - elapsed),
    bettingRemainingMs: Math.max(0, BETTING_LENGTH - elapsed),
    result: currentResult,
    recentResults
  };
}

async function getPools() {
  const rows = await Bet.aggregate([
    {
      $match: {
        roundId,
        result: "PENDING"
      }
    },
    {
      $group: {
        _id: "$side",
        total: { $sum: "$amount" }
      }
    }
  ]);

  const pools = {
    HEADS: 0,
    TAILS: 0
  };

  for (const row of rows) {
    pools[row._id] = row.total;
  }

  return pools;
}

function broadcastState() {
  io.emit("game:state", publicState());
}

/* =========================================================
   RESULT ENGINE
========================================================= */

async function calculateResult() {
  const pools = await getPools();

  let result;

  if (forceMode === "HEADS") {
    result = "HEADS";
  } else if (forceMode === "TAILS") {
    result = "TAILS";
  } else {
    if (pools.HEADS === pools.TAILS) {
      result = Math.random() < 0.5 ? "HEADS" : "TAILS";
    } else {
      result =
        pools.HEADS < pools.TAILS
          ? "HEADS"
          : "TAILS";
    }
  }

  return result;
}

/* =========================================================
   ROUND SETTLEMENT
========================================================= */

async function settleRound() {
  try {
    roundPhase = "RESULT";

    currentResult = await calculateResult();

    const session = await mongoose.startSession();

    try {
      await session.withTransaction(async () => {
        const winningBets = await Bet.find({
          roundId,
          side: currentResult
        }).session(session);

        const losingBets = await Bet.find({
          roundId,
          side: { $ne: currentResult }
        }).session(session);

        for (const bet of winningBets) {
          const payout = bet.amount * 2;

          await User.updateOne(
            { username: bet.username },
            {
              $inc: {
                balance: payout
              }
            },
            { session }
          );

          bet.result = "WIN";
          bet.payout = payout;

          await bet.save({ session });
        }

        await Bet.updateMany(
          {
            _id: {
              $in: losingBets.map((b) => b._id)
            }
          },
          {
            $set: {
              result: "LOSS",
              payout: 0
            }
          },
          { session }
        );

        await Round.updateOne(
          { roundId },
          {
            $set: {
              result: currentResult,
              endedAt: new Date()
            }
          },
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    recentResults.unshift(currentResult);

    if (recentResults.length > 15) {
      recentResults.pop();
    }

    io.emit("game:result", {
      roundId,
      result: currentResult,
      recentResults
    });

    setTimeout(startNewRound, 3000);
  } catch (error) {
    console.error("Settlement error:", error);
  }
}

/* =========================================================
   NEW ROUND
========================================================= */

async function startNewRound() {
  roundId++;
  roundStartedAt = Date.now();
  roundPhase = "BETTING";
  currentResult = null;

  try {
    await Round.create({
      roundId,
      heads: 0,
      tails: 0,
      startedAt: new Date()
    });
  } catch (error) {
    console.error("Round creation error:", error);
  }

  io.emit("game:new-round", {
    roundId
  });

  broadcastState();
}

/* =========================================================
   CLOCK
========================================================= */

function runGameClock() {
  clearInterval(gameTimer);

  gameTimer = setInterval(async () => {
    const elapsed = Date.now() - roundStartedAt;

    if (
      roundPhase === "BETTING" &&
      elapsed >= BETTING_LENGTH
    ) {
      roundPhase = "LOCKED";

      io.emit("game:locked", {
        roundId
      });
    }

    if (
      roundPhase === "LOCKED" &&
      elapsed >= ROUND_LENGTH
    ) {
      clearInterval(gameTimer);
      await settleRound();
    }

    broadcastState();
  }, 250);
}

/* =========================================================
   AUTH
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");

    if (username.length < 3) {
      return res.status(400).json({
        error: "Username minimum 3 characters."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: "Password minimum 6 characters."
      });
    }

    const exists = await User.exists({ username });

    if (exists) {
      return res.status(409).json({
        error: "Username already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await User.create({
      username,
      passwordHash,
      balance: 0
    });

    req.session.username = username;

    res.json({
      success: true,
      username,
      balance: 0
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Registration failed."
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = cleanUsername(req.body.username);
    const password = String(req.body.password || "");

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!valid) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    req.session.username = username;

    res.json({
      success: true,
      username,
      balance: user.balance
    });
  } catch (error) {
    res.status(500).json({
      error: "Login failed."
    });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({
      success: true
    });
  });
});

app.get("/api/me", async (req, res) => {
  if (!req.session.username) {
    return res.json({
      loggedIn: false
    });
  }

  const user = await User.findOne({
    username: req.session.username
  }).lean();

  if (!user) {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    username: user.username,
    balance: user.balance
  });
});

/* =========================================================
   DEMO WALLET
========================================================= */

app.post("/api/demo-credit", async (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({
      error: "Login required."
    });
  }

  const amount = Number(req.body.amount);

  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 10000
  ) {
    return res.status(400).json({
      error: "Invalid demo amount."
    });
  }

  const user = await User.findOneAndUpdate(
    {
      username: req.session.username
    },
    {
      $inc: {
        balance: amount
      }
    },
    {
      new: true
    }
  );

  res.json({
    success: true,
    balance: user.balance
  });
});

/* =========================================================
   BET
========================================================= */

app.post("/api/bet", async (req, res) => {
  try {
    if (!req.session.username) {
      return res.status(401).json({
        error: "Login required."
      });
    }

    if (roundPhase !== "BETTING") {
      return res.status(400).json({
        error: "Betting is locked."
      });
    }

    const side = cleanSide(req.body.side);
    const amount = Number(req.body.amount);

    if (!side) {
      return res.status(400).json({
        error: "Invalid side."
      });
    }

    if (
      !Number.isFinite(amount) ||
      amount < 1 ||
      amount > 100000
    ) {
      return res.status(400).json({
        error: "Invalid amount."
      });
    }

    const existingBet = await Bet.exists({
      roundId,
      username: req.session.username
    });

    if (existingBet) {
      return res.status(400).json({
        error: "One bet per round only."
      });
    }

    const updatedUser = await User.findOneAndUpdate(
      {
        username: req.session.username,
        balance: {
          $gte: amount
        }
      },
      {
        $inc: {
          balance: -amount
        }
      },
      {
        new: true
      }
    );

    if (!updatedUser) {
      return res.status(400).json({
        error: "Insufficient demo balance."
      });
    }

    try {
      await Bet.create({
        roundId,
        username: req.session.username,
        side,
        amount
      });
    } catch (error) {
      await User.updateOne(
        {
          username: req.session.username
        },
        {
          $inc: {
            balance: amount
          }
        }
      );

      if (error.code === 11000) {
        return res.status(400).json({
          error: "Bet already placed."
        });
      }

      throw error;
    }

    await Round.updateOne(
      {
        roundId
      },
      {
        $inc: {
          [side === "HEADS" ? "heads" : "tails"]: amount
        }
      }
    );

    res.json({
      success: true,
      balance: updatedUser.balance,
      roundId,
      side,
      amount
    });

    io.emit("feed:new", {
      text: `${req.session.username} placed a demo bet on ${side}.`
    });
  } catch (error) {
    console.error("Bet error:", error);

    res.status(500).json({
      error: "Could not place bet."
    });
  }
});

/* =========================================================
   USER HISTORY
========================================================= */

app.get("/api/history", async (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({
      error: "Login required."
    });
  }

  const bets = await Bet.find({
    username: req.session.username
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json({
    bets
  });
});

/* =========================================================
   ADMIN
========================================================= */

function adminRequired(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({
      error: "Admin authentication required."
    });
  }

  next();
}

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body.password || "");

  if (
    !process.env.ADMIN_PASS ||
    password !== process.env.ADMIN_PASS
  ) {
    return res.status(401).json({
      error: "Invalid admin password."
    });
  }

  req.session.admin = true;

  res.json({
    success: true
  });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.admin = false;

  res.json({
    success: true
  });
});

app.get(
  "/api/admin/state",
  adminRequired,
  async (req, res) => {
    const pools = await getPools();

    const totalUsers = await User.countDocuments();

    const activeUsers = onlineUsers.size;

    const allBets = await Bet.countDocuments();

    res.json({
      roundId,
      phase: roundPhase,
      result: currentResult,
      forceMode,
      pools,
      totalUsers,
      activeUsers,
      totalBets: allBets,
      recentResults
    });
  }
);

app.post(
  "/api/admin/mode",
  adminRequired,
  async (req, res) => {
    const mode = String(req.body.mode || "AUTO").toUpperCase();

    if (!["AUTO", "HEADS", "TAILS"].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode."
      });
    }

    forceMode = mode;

    io.emit("admin:mode-changed", {
      mode: forceMode
    });

    res.json({
      success: true,
      mode: forceMode
    });
  }
);

app.get(
  "/api/admin/users",
  adminRequired,
  async (req, res) => {
    const search = String(req.query.search || "")
      .trim()
      .toLowerCase();

    const query = search
      ? {
          username: {
            $regex: search,
            $options: "i"
          }
        }
      : {};

    const users = await User.find(query)
      .select("username balance createdAt")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      users
    });
  }
);

app.post(
  "/api/admin/wallet",
  adminRequired,
  async (req, res) => {
    const username = cleanUsername(req.body.username);
    const action = String(req.body.action || "").toLowerCase();
    const amount = Number(req.body.amount);

    if (!username) {
      return res.status(400).json({
        error: "Username required."
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Invalid amount."
      });
    }

    let update;

    if (action === "add") {
      update = {
        $inc: {
          balance: amount
        }
      };
    } else if (action === "deduct") {
      update = {
        $inc: {
          balance: -amount
        }
      };
    } else if (action === "reset") {
      update = {
        $set: {
          balance: 0
        }
      };
    } else {
      return res.status(400).json({
        error: "Invalid wallet action."
      });
    }

    const user = await User.findOneAndUpdate(
      action === "deduct"
        ? {
            username,
            balance: {
              $gte: amount
            }
          }
        : {
            username
          },
      update,
      {
        new: true
      }
    );

    if (!user) {
      return res.status(400).json({
        error: "User not found or insufficient balance."
      });
    }

    io.emit("user:wallet-updated", {
      username,
      balance: user.balance
    });

    res.json({
      success: true,
      username,
      balance: user.balance
    });
  }
);

/* =========================================================
   SOCKET.IO
========================================================= */

io.on("connection", (socket) => {
  socket.emit("game:state", publicState());

  socket.on("user:online", (username) => {
    if (username) {
      onlineUsers.add(username);
    }
  });

  socket.on("user:offline", (username) => {
    if (username) {
      onlineUsers.delete(username);
    }
  });

  socket.on("admin:subscribe", (data) => {
    if (data && data.admin === true) {
      socket.join("admin_room");
    }
  });

  socket.on("admin:pools", async () => {
    if (!socket.rooms.has("admin_room")) return;

    const pools = await getPools();

    io.to("admin_room").emit("admin:pools", {
      roundId,
      pools
    });
  });

  socket.on("disconnect", () => {
    // Socket disconnect handled naturally.
  });
});

/* =========================================================
   START
========================================================= */

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log("MongoDB connected.");

    const latestRound = await Round.findOne()
      .sort({ roundId: -1 })
      .lean();

    if (latestRound) {
      roundId = latestRound.roundId + 1;
    }

    await Round.create({
      roundId,
      heads: 0,
      tails: 0,
      startedAt: new Date()
    });

    roundStartedAt = Date.now();

    runGameClock();

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }
}

start();