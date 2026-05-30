const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================== DATABASE CONFIGURATION ==================
const db = new sqlite3.Database("./db.sqlite");

db.serialize(() => {
  // USERS TABLE
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 300,
    referral TEXT,
    level1 TEXT,
    level2 TEXT,
    level3 TEXT,
    is_banned INTEGER DEFAULT 0
  )`);

  // VIP TABLE
  db.run(`CREATE TABLE IF NOT EXISTS vip (
    id INTEGER PRIMARY KEY,
    name TEXT,
    price REAL,
    daily REAL,
    days INTEGER
  )`);

  // PURCHASES TABLE
  db.run(`CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    vipId INTEGER,
    time TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // TRANSACTIONS TABLE
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    type TEXT,
    amount REAL,
    status TEXT,
    time TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // WITHDRAW TABLE
  db.run(`CREATE TABLE IF NOT EXISTS withdraw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    account TEXT,
    amount REAL,
    fee REAL,
    status TEXT DEFAULT 'pending'
  )`);

  // VIP DATA INSERTION
  const vipData = [
    [1, "VIP1", 900, 100, 150],
    [2, "VIP2", 1800, 300, 150],
    [3, "VIP3", 3600, 650, 150],
    [4, "VIP4", 7200, 1380, 150],
    [5, "VIP5", 10000, 1940, 150]
  ];

  vipData.forEach(v => {
    db.run("INSERT OR IGNORE INTO vip VALUES (?,?,?,?,?)", v);
  });
});

// ================== FIXED PLATFORM CONFIG (TG & SUPPORT) ==================
const config = {
  telegram: "https://t.me/Jersey_official",
  support: "@Jersey_Hfc1",
  adminPhone: "0905295422", // ያንተ የቴሌብር ስልክ ቁጥር
  adminPassword: "ADMIN_PASSWORD_HERE" // የአድሚን ፓስዎርድ እዚህ ይቀይሩ
};

// BAN CHECK MIDDLEWARE
function checkBan(req, res, next) {
  const phone = req.body.phone;
  db.get("SELECT is_banned FROM users WHERE phone = ?", [phone], (err, user) => {
    if (user && user.is_banned === 1) {
      return res.send("Your Account Has Been Banned!");
    }
    next();
  });
}

// ================== BACKEND APIS ==================

// REGISTER
app.post("/register", (req, res) => {
  const { phone, password, ref } = req.body;
  db.run("INSERT INTO users(phone,password,referral) VALUES (?,?,?)", [phone, password, ref], (err) => {
    if (err) return res.send("Registration Failed or Phone Number Already Exists");
    res.send("Registered");
  });
});

// LOGIN
app.post("/login", checkBan, (req, res) => {
  const { phone, password } = req.body;
  db.get("SELECT * FROM users WHERE phone=? AND password=?", [phone, password], (err, user) => {
    if (!user) return res.send("Wrong login");
    res.send(user);
  });
});

// BUY VIP
app.post("/buy", (req, res) => {
  const { phone, vipId } = req.body;
  db.get("SELECT * FROM vip WHERE id=?", [vipId], (e, vip) => {
    db.get("SELECT * FROM users WHERE phone=?", [phone], (e, user) => {
      if (user.balance < vip.price) return res.send("No balance");

      db.run("UPDATE users SET balance=balance-? WHERE phone=?", [vip.price, phone]);
      db.run("INSERT INTO purchases(phone,vipId) VALUES (?,?)", [phone, vipId]);
      res.send("VIP Purchased");
    });
  });
});

// DAILY INTEREST (CRON/INTERVAL)
setInterval(() => {
  db.all("SELECT * FROM purchases", (e, rows) => {
    if (rows) {
      rows.forEach(p => {
        db.get("SELECT * FROM vip WHERE id=?", [p.vipId], (e, v) => {
          if (v) db.run("UPDATE users SET balance=balance+? WHERE phone=?", [v.daily, p.phone]);
        });
      });
    }
  });
}, 86400000);

// DEPOSIT (REQUEST TO ADMIN)
app.post("/deposit", (req, res) => {
  const { phone, amount, txId } = req.body;
  db.run("INSERT INTO transactions(phone,type,amount,status) VALUES (?,?,?,?)", [phone, txId, amount, "pending"], (err) => {
    if (err) return res.send("Transaction ID already used!");
    res.send("Deposit sent to admin for approval");
  });
});

// WITHDRAW
app.post("/withdraw", (req, res) => {
  const { phone, amount, account } = req.body;
  const fee = amount * 0.15;
  db.run("INSERT INTO withdraw(phone,account,amount,fee) VALUES (?,?,?,?)", [phone, account, amount, fee], () => {
    res.send("Withdraw request sent");
  });
});

// CHECKIN
app.get("/checkin/:phone", (req, res) => {
  db.run("UPDATE users SET balance=balance+20 WHERE phone=?", [req.params.phone], () => {
    res.send("20 ETB added");
  });
});

// REFERRAL BONUS CALCULATION
function referralBonus(amount) {
  return { l1: amount * 0.20, l2: amount * 0.02, l3: amount * 0.01 };
}

// ================== ADMIN PANEL APIS ==================
app.get("/admin/stats", (req, res) => {
  db.all("SELECT type,SUM(amount) as total FROM transactions GROUP BY type", (e, data) => {
    res.json(data);
  });
});

app.get("/admin", (req, res) => {
  db.all("SELECT * FROM withdraw WHERE status='pending'", (e, w) => {
    res.json({ withdrawRequests: w });
  });
});

// ADMIN APPROVE DEPOSIT ACTION
app.post("/admin/approve-deposit", (req, res) => {
  const { adminPhone, adminPassword, txId, userPhone, amount } = req.body;
  if (adminPhone !== config.adminPhone || adminPassword !== config.adminPassword) {
    return res.status(401).send("Unauthorized Admin Login!");
  }
  db.run("UPDATE users SET balance = balance + ? WHERE phone = ?", [amount, userPhone], () => {
    db.run("UPDATE transactions SET status = 'approved' WHERE type = ?", [txId]);
    res.send("Deposit Approved Successfully!");
  });
});

// ADMIN BAN USER
app.post("/admin/ban-user", (req, res) => {
  const { adminPhone, adminPassword, targetPhone, action } = req.body; // action: 1 to ban, 0 to unban
  if (adminPhone !== config.adminPhone || adminPassword !== config.adminPassword) {
    return res.status(401).send("Unauthorized!");
  }
  db.run("UPDATE users SET is_banned = ? WHERE phone = ?", [action, targetPhone], () => {
    res.send(action === 1 ? "User Banned" : "User Unbanned");
  });
});

// ================== FRONTEND HTML INTEGRATION ==================
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<title>Jersey Platform</title>
<style>
body { font-family: Arial; background:#111; color: white; display:flex; flex-direction:column; align-items:center; padding:20px; }
.box, .deposit-box, .admin-panel { background:#1d1d1d; padding:20px; width:90%; max-width:450px; border-radius:10px; margin-bottom:20px; box-shadow:0 0 10px rgba(0,0,0,0.5); }
input, select, textarea { width:100%; padding:12px; margin:8px 0; border:none; border-radius:6px; background:#222; color:white; box-sizing: border-box; }
button { width:100%; padding:12px; background:#00b894; color:white; border:none; border-radius:6px; cursor:pointer; font-size:16px; margin-top:10px; }
button:hover { background:#00a383; }
.card { background:#2d3436; padding:10px; margin-top:10px; border-radius:6px; }
.ban-btn { background:red; }
.unban-btn { background:#0984e3; }
</style>
</head>
<body>

<h1>Jersey Platform</h1>
<h2>Balance: <span id="balance">0</span> ETB</h2>

<!-- DEPOSIT BOX -->
<div class="deposit-box">
  <h2>Deposit</h2>
  <label>Select Deposit Amount</label>
  <select id="depositAmount">
    <option value="900">900 ETB</option>
    <option value="1800">1800 ETB</option>
    <option value="3600">3600 ETB</option>
    <option value="7200">7200 ETB</option>
    <option value="10000">10000 ETB</option>
  </select>

  <div style="background:#222; padding:12px; border-radius:6px; margin-bottom:15px;">
    <h3>Deposit Account</h3>
    <p><strong>TELEBIRR</strong></p>
    <p>Name: <strong>AMANUEAL</strong></p>
    <p>ACC: <strong>${config.adminPhone}</strong></p>
  </div>

  <label>Paste Telebirr SMS Here</label>
  <textarea id="smsInput" rows="6" placeholder="Paste Telebirr SMS Here"></textarea>
  <button onclick="submitDeposit()">Submit Deposit</button>
  <p id="result"></p>
</div>

<!-- WITHDRAW BOX -->
<div class="box">
  <h3>Withdraw Money</h3>
  <input id="withdrawAmount" type="number" placeholder="Amount">
  <h4>Add Bank Card</h4>
  <input id="cardName" type="text" placeholder="Card Holder Name">
  <input id="cardNumber" type="text" placeholder="Card Number">
  <button onclick="saveCard()">Save Card</button>
  <div id="savedCard"></div>
  <button style="margin-top:15px;" onclick="withdraw()">Withdraw</button>
</div>

<script>
let userBalance = localStorage.getItem("userBalance") || 0;
document.getElementById("balance").innerText = userBalance;

function saveCard(){
  let name = document.getElementById("cardName").value;
  let number = document.getElementById("cardNumber").value;
  localStorage.setItem("bankCard", JSON.stringify({name, number}));
  showCard();
}

function showCard(){
  let data = JSON.parse(localStorage.getItem("bankCard"));
  if(data){
    document.getElementById("savedCard").innerHTML = \`
      <div class="card">
        <b>Saved Card</b><br>Name: \${data.name}<br>Number: \${data.number}
      </div>\`;
  }
}

function withdraw(){
  let amount = document.getElementById("withdrawAmount").value;
  let card = JSON.parse(localStorage.getItem("bankCard"));
  if(!amount || !card){ alert("Fill amount and add card first"); return; }
  alert("Withdraw request sent to server");
}

function submitDeposit(){
  let sms = document.getElementById("smsInput").value;
  let amountMatch = sms.match(/ETB\\s([\\d,]+\\.\\d{2})/i);
  let transactionMatch = sms.match(/transaction number is\\s([A-Z0-9]+)/i);

  if(!amountMatch || !transactionMatch){
    alert("Invalid Telebirr SMS!");
    return;
  }

  let amount = parseFloat(amountMatch[1].replace(/,/g,''));
  let transactionId = transactionMatch[1];

  let usedTransactions = JSON.parse(localStorage.getItem("usedTransactions")) || [];
  if(usedTransactions.includes(transactionId)){
    alert("This transaction ID has already been used!");
    return;
  }

  usedTransactions.push(transactionId);
  localStorage.setItem("usedTransactions", JSON.stringify(usedTransactions));

  // Simulating instant check text for user transparency
  document.getElementById("result").innerHTML = \`
    <div style="color:lime; margin-top:10px;">
      Deposit Sent for Verification!<br>
      TXID: \${transactionId}<br>
      Amount: \${amount} ETB<br>
      Status: Pending Admin Approval
    </div>\`;
}
showCard();
</script>
</body>
</html>
  `);
});

// ================== SERVER START ==================
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
