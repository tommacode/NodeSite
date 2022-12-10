const express = require("express");
const app = express();
require("dotenv").config();
const fs = require("fs");
const path = require("path");
app.use(express.static(path.join(__dirname, "Pages")));
const mysql = require("mysql2");
//body parser
const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
//app.use(express.json());
//app.use(express.urlencoded({ extended: true }));
//Send grid
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SG_API_KEY);
//Rate limit
const rateLimit = require("express-rate-limit");
//Proxied
if (process.env.PROXIED == "true") {
  app.set("trust proxy", 1);
}
//Password hashing
const crypto = require("crypto");

const cookies = require("cookie-parser");
app.use(cookies());

//Headers
app.set("x-powered-by", false);
//Rate limit
const CommentLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins window
  max: 5, // start blocking after the 5th request
  message: 429, //Send too many requests error
});

const pool = mysql.createPool({
  connectionLimit: 10,
  host: process.env.DB_IP,
  user: process.env.DB_User,
  password: process.env.DB_Password,
  database: process.env.DB_Name,
}).promise();

function Logs(req, StatusCode) {
  const date = new Date();
  //Change date to datetime value
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Get IP
  const ip = req.ip;
  //Get Forwarded for
  let forwardedfor = req.headers["x-forwarded-for"];
  if (forwardedfor == undefined) {
    forwardedfor = ip;
  }
  //Get User Agent
  const useragent = req.headers["user-agent"];
  //Get Method
  const method = req.method;
  //Get Path
  const path = req.path;
  console.log(
    `${datetime} | ${ip} | ${forwardedfor} | ${useragent} | ${method} | ${path} | ${StatusCode}`
  );
  const sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    datetime,
    ip,
    forwardedfor,
    useragent,
    method,
    path,
    StatusCode,
  ];
  pool.query(sql, values)
}

async function Authorised(cookie, pool) {
  if (cookie == undefined) {
    return false
  }
  let sql = `SELECT UserID FROM sessions WHERE Cookie = ?`
  let [result] = await pool.query(sql, [cookie])
  if (result[0].UserID == undefined) {
    return false
  }
  result = result[0].UserID
  sql = 'SELECT Sudo FROM Users WHERE ID = ?'
  let [sudo] = await pool.query(sql, [result])
  sudo = sudo[0].Sudo
  if (sudo == 1) {
    return true
  }
}

async function GetUserID(cookie) {
  if (cookie == undefined) {
    return null;
  }
  let sql = `SELECT UserID FROM Sessions WHERE cookie = ?`;
  const [result] = await pool.query(sql, [cookie])
  return result[0].UserID;
}

function SendEmail(Recipient, Subject, Content) {
  const msg = {
    to: Recipient,
    from: process.env.SENDER_EMAIL,
    subject: Subject,
    text: Content,
  };
  sgMail.send(msg);
}

function ValidateEmail(email) {
  const re = /\S+@\S+\.\S+/;
  return re.test(email);
}

//HTML responses
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "index.html"));
  Logs(req, 200);
});

app.get("/projects", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "NavPage.html"));
  Logs(req, 200);
});

app.get("/projects/*", (req, res) => {
  //Check if project exists if it doesn't then redirect back to the nav page
  res.sendFile(__dirname + "/Pages/article.html");
  Logs(req, 200);
});

app.get("/createArticle", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "createArticle.html"));
  Logs(req, 200);
});

app.get("/css.css", (req, res) => {
  res.sendFile(__dirname + "/Pages/css.css");
  Logs(req, 200);
});

app.get("/favicon.ico", (req, res) => {
  res.sendFile(__dirname + "/Pages/favicon32.ico");
  Logs(req, 200);
});

app.get('/SignUp', (req, res) => {
  res.sendFile(__dirname + "/Pages/signUp.html");
  Logs(req, 200);
})

app.get('/Login', (req, res) => {
  res.sendFile(__dirname + "/Pages/login.html");
  Logs(req, 200);
})

//API responses
//General
app.get("/api/projects", async (req, res) => {
  const cookie = req.cookies;
  let sql;
  if (cookie["Auth"] == process.env.ManagementToken) {
    sql = "SELECT Time,Title,Appetizer,Status FROM Projects";
  } else {
    sql = `SELECT Time,Title,Appetizer,Status FROM Projects WHERE Status = 1`;
  }
  const [result] = await pool.query(sql)
  res.send(result);
  Logs(req, 200);
});

app.get("/api/projects/:project", async (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  let sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? AND Status = 1`;
  const [result] = await pool.query(sql, [project])
  const UserID = await GetUserID(cookies["Auth"])
  sql = `SELECT count(*) FROM projectLikes WHERE UserID = ? AND Project = ?`
  const [liked] = await pool.query(sql, [UserID, project])
  if (liked[0]["count(*)"] == 1) {
    result[0].Liked = true
  } else {
    result[0].Liked = false
  }
  if (result.length == 0) {
    res.sendStatus(404);
    Logs(req, 404);
  } else {
    res.send(result);
    Logs(req, 200);
  }
});

app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "robots.txt"));
  Logs(req, 200);
});

app.get("/photos/:photo", (req, res) => {
  try {
    const photo = req.params.photo;
    res.sendFile(__dirname + "/Photos/" + photo);
    Logs(req, 200);
  } catch (err) {
    console.log("/photos/:photo");
  }
});

//Likes
app.get("/api/projects/:project/like", async (req, res) => {
  const UserID = await GetUserID(req.cookies["Auth"])
  if (UserID != null) {
    let project = req.params.project;
    project = project.replaceAll("-", " ");
    let sql = `UPDATE Projects SET Likes = Likes + 1 WHERE Title = "${project}"`;
    pool.query(sql)
    sql = `INSERT INTO ProjectLikes (Project, UserID) VALUES (?, ?)`;
    pool.query(sql, [project, UserID])
    res.sendStatus(204);
    Logs(req, 204);
  }
});

app.get("/api/projects/:project/dislike", async (req, res) => {
  const UserID = await GetUserID(req.cookies["Auth"]);
  if (UserID != null) {
    let project = req.params.project;
    project = project.replaceAll("-", " ");
    let sql = `UPDATE Projects SET Likes = Likes - 1 WHERE Title = "${project}"`;
    pool.query(sql)
    sql = `DELETE FROM ProjectLikes WHERE Project = ? AND UserID = ?`;
    pool.query(sql, [project, UserID])
    res.sendStatus(204);
    Logs(req, 204);
  }
});

//Comments
app.post("/api/projects/:project/comment", CommentLimit, async (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  let comment = req.body.comment;
  comment = comment.replaceAll('"', '""');
  //Get Current time as datetime
  const date = new Date();
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Create random id with letters and numbers
  const id =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);

  if (ValidateEmail(req.body.email)) {
    SendEmail(
      req.body.email,
      "New Comment",
      `Name: ${name}\nEmail: ${req.body.email}\nComment: ${comment}`
    );
  }
  const UserID = await GetUserID(req.cookies["Auth"]);
  const sql = `INSERT INTO Comments (Project,UserID,Content,Time,Likes,Unique_id) VALUES (?, ?, ?, ?, ?, ?)`;
  const values = [project, UserID, comment, datetime, 0, id];
  pool.query(sql, values)
  res.sendStatus(204);
  Logs(req, 204);
});

app.get("/api/projects/:project/comments", async (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  let sql = `SELECT UserID,Content,Likes,Unique_id FROM Comments Where Project = ? ORDER BY FIELD(Unique_id, ?) DESC, Likes DESC`;
  let [result] = await pool.query(sql, [project, req.cookies.comment])
  if (result.length > 0) {
    if (result[0].Unique_id == req.cookies.comment) {
      result[0].Name = result[0].Name + " (You)";
    }
  }
  for (i = 0; i < result.length; i++) {
    sql = `SELECT Username FROM Users WHERE ID = ?`;
    const [user] = await pool.query(sql, [result[i].UserID]);
    result[i].Name = user[0].Username;
    delete result[i].UserID;
  }
  const UserID = await GetUserID(req.cookies["Auth"])
  if (UserID != null) {
    for (let i = 0; i < result.length; i++) {
      sql = `SELECT count(*) FROM CommentLikes WHERE UserID = ? AND Unique_id = ?`
      const [liked] = await pool.query(sql, [UserID, result[i].Unique_id])
      if (liked[0]["count(*)"] == 1) {
        result[i].Liked = true
      } else {
        result[i].Liked = false
      }
    }
  }
  res.send(result);
  Logs(req, 200);
});

//Comment likes
app.get("/api/comments/:id/like", async (req, res) => {
  const UserID = await GetUserID(req.cookies["Auth"])
  if (UserID != null) {
    const id = req.params.id;
    let sql = `UPDATE Comments SET Likes = Likes + 1 WHERE unique_id = ?`;
    pool.query(sql, [id])
    sql = `INSERT INTO CommentLikes (Unique_id, UserID) VALUES (?, ?)`;
    pool.query(sql, [id, UserID])
    res.sendStatus(204);
    Logs(req, 204);
  }
});

app.get("/api/comments/:id/dislike", async (req, res) => {
  const UserID = await GetUserID(req.cookies["Auth"])
  if (UserID != null) {
    const id = req.params.id;
    let sql = `UPDATE Comments SET Likes = Likes - 1 WHERE unique_id = ?`;
    pool.query(sql, [id])
    sql = `DELETE FROM CommentLikes WHERE unique_id = ? AND UserID  = ?`;
    pool.query(sql, [id, UserID])
    res.sendStatus(204);
    Logs(req, 204);
  }
});

//Post Data
app.post("/api/projects/new", async (req, res) => {
  const password = req.cookies.Auth;
  let title = req.body.title;
  let appetizer = req.body.appetizer;
  let Content = req.body.content;
  let tags = req.body.tags;
  let Status = req.body.visibility;

  //Replace all " with ""
  title = title.replaceAll('"', '""');
  appetizer = appetizer.replaceAll('"', '""');
  Content = Content.replaceAll('"', '""');
  tags = tags.replaceAll('"', '""');

  if (password == process.env.ManagementToken) {
    //Send Email With sendgrid
    const msg = {
      to: process.env.EMAIL,
      from: process.env.SENDER_EMAIL,
      subject: "New Project Created",
      text: `Hello,\n\nSomeone has successfully created a new article on the website (tomblake.me) the details are: Title: ${title} Appetizer: ${appetizer} Content: ${Content} Tags: ${tags} Status: ${Status}`,
    };
    sgMail.send(msg);
    if (Status == "Public") {
      Status = 1;
    } else {
      Status = 0;
    }
    //Get current time as datetime
    const date = new Date();
    const datetime = date.toISOString().slice(0, 19).replace("T", " ");
    const sql = `INSERT INTO Projects (Time, Title, Appetizer, Content, Tags, Status, Likes) VALUES (?, ?, ?, ?, ?, ?, 0)`;
    await pool.query(sql, [datetime, title, appetizer, Content, tags, Status])
      .then(() => {
        res.send(
          `Successfully added project the visibility is set to ${Status}`
        );
      })
    Logs(req, 200);
  } else {
    res.sendStatus(401);
    Logs(req, 401);
  }
});

app.post("/api/projects/:id/edit", (req, res) => {
  const password = req.cookies.Auth;

  if (password == process.env.ManagementToken) {
    let id = req.params.id;
    let title = req.body.title;
    let appetizer = req.body.appetizer;
    let content = req.body.content;
    let tags = req.body.tags;

    //Replace all " with ""
    title = title.replaceAll('"', '""');
    appetizer = appetizer.replaceAll('"', '""');
    content = content.replaceAll('"', '""');
    tags = tags.replaceAll('"', '""');
    //sql = `UPDATE Projects SET Title = "${title}", Appetizer = "${appetizer}", Content = "${Content}", Tags = "${tags}" WHERE id = ${id}`;
    //Rewrite statment to use prepared statements
    let sql = `UPDATE Projects SET Title = ?, Appetizer = ?, Content = ?, Tags = ? WHERE id = ?`;
    pool.query(sql, [title, appetizer, content, tags, id]);
    res.send("Successfully updated project")
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

//Management
app.get("/management", async (req, res) => {
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool) == true) {
    res.sendFile(__dirname + "/AdminPages/management.html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
  }
});

app.get("/management/:Page", async (req, res) => {
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    res.sendFile(__dirname + "/AdminPages/" + req.params.Page + ".html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
  }
});

app.get("/api/showImages", async (req, res) => {
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    const fs = require("fs");
    const files = fs.readdirSync(__dirname + "/Photos");
    res.send(files);
    Logs(req, 200);
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

//Login
app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/Pages/login.html");
  Logs(req, 200);
});

app.post("/api/projects/:project/visibility", (req, res) => {
  const project = req.params.project;
  const cookies = req.cookies;
  if (Authorised(cookies["Auth"], pool)) {
    //use mysql if statement if status = 1 then set to 0 else set to 1
    let sql = `UPDATE Projects SET Status = IF(Status = 1, 0, 1) WHERE title = ?`;
    pool.query(sql, [project]);
    res.sendStatus(204);
    Logs(req, 204);
  }
});

//User accounts
app.post("/api/user/create", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const email = req.body.email;
  //Check for the username existing
  let sql = 'SELECT count(*) FROM Users WHERE Username = ?'
  const [result] = await pool.query(sql, [username])
  //Create hash with crypto sha256
  if (result[0]["count(*)"] == 0) {
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    sql = `INSERT INTO Users (Username, Password, Email) VALUES (?, ?, ?)`;
    pool.query(sql, [username, passwordHash, email]);
    res.sendStatus(200);
    Logs(req, 200);
  } else {
    res.sendStatus(409);
    Logs(req, 409);
  }
})

app.post("/api/user/login", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  let sql = `SELECT * FROM Users WHERE Username = ? AND Password = ?`;
  const [result] = await pool.query(sql, [username, passwordHash])
  if (result.length == 1) {
    //Make a cookie with the username current time and a random number
    const date = new Date();
    const datetime = date.toISOString().slice(0, 19).replace("T", " ");
    const cookie = crypto.createHash('sha256').update(username + datetime + crypto.randomBytes(16).toString("hex")).digest('hex');
    sql = `INSERT INTO sessions (Cookie, UserID) VALUES (?, ?)`;
    await pool.query(sql, [cookie, result[0].ID]);
    res.cookie("Auth", cookie);
    res.sendStatus(200);
    Logs(req, 200);
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

app.get("/api/user", async (req, res) => {
  const cookie = req.cookies.Auth;
  let sql = `SELECT * FROM Sessions WHERE Cookie = ?`;
  let [result] = await pool.query(sql, [cookie])
  if (result.length == 1) {
    sql = `SELECT Username,Sudo FROM Users WHERE id = ?`;
    [result] = await pool.query(sql, [result[0].UserID]);
    res.send(result[0]);
    Logs(req, 200);
  } else {
    res.sendStatus(204);
    Logs(req, 204);
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});