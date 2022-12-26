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
const e = require("express");
app.use(cookies());

//EJS
app.set("view engine", "ejs");

//Headers
app.set("x-powered-by", false);
//Rate limit
const CommentLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 mins window
  max: 5, // start blocking after the 5th request
  message: 429, //Send too many requests error
});

const LikeLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min window
  max: 10, // start blocking after the 10th request
  //Send RateLimit.html as the message
  message: 429,
});

const pool = mysql
  .createPool({
    connectionLimit: 10,
    host: process.env.DB_IP,
    user: process.env.DB_User,
    password: process.env.DB_Password,
    database: process.env.DB_Name,
  })
  .promise();

async function Logs(req, StatusCode) {
  const date = new Date();
  //Change date to datetime value
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Get IP
  const ip = req.ip;
  //Get Forwarded for
  let forwardedfor;
  if (req.headers["x-forwarded-for"] != undefined) {
    forwardedfor = req.headers["x-forwarded-for"];
  } else {
    forwardedfor = ip;
  }
  //Get User Agent
  const useragent = req.headers["user-agent"];
  //Get Method
  const method = req.method;
  //Get Path
  const path = req.path;
  //Get Logged in user
  const cookie = req.cookies["Auth"];
  let Username;
  if (cookie != undefined) {
    let sql = `SELECT Users.Username FROM Users,Sessions WHERE Sessions.UserID = Users.ID AND Sessions.Cookie = ?`;
    let [User] = await pool.query(sql, [cookie]);
    if (User.length == 0) {
      Username = "Not Logged In";
    } else {
      Username = `User: ${User[0].Username}`;
    }
  } else {
    Username = "Not Logged In";
  }

  console.log(
    `${datetime} | ${ip} | ${forwardedfor} | ${useragent} | ${method} | ${path} | ${StatusCode} | ${Username}`
  );
  sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    datetime,
    ip,
    forwardedfor,
    useragent,
    method,
    path,
    StatusCode,
  ];
  pool.query(sql, values);
}

async function Authorised(cookie, pool) {
  if (cookie == undefined) {
    return false;
  }
  // sql = `
  let sql = `SELECT UserID FROM Sessions WHERE Cookie = ?`;
  let [result] = await pool.query(sql, [cookie]);
  if (result.length == 0) {
    return false;
  }
  result = result[0].UserID;
  sql = "SELECT Sudo FROM Users WHERE ID = ?";
  let [sudo] = await pool.query(sql, [result]);
  sudo = sudo[0].Sudo;
  if (sudo == 1) {
    return true;
  }
}

async function GetUserID(cookie, req) {
  if (cookie == undefined) {
    return null;
  }
  const [result] = await pool.query(
    "SELECT UserID FROM Sessions WHERE cookie = ?",
    [cookie]
  );
  //Update lastused time, UserAgentLastSeen, IPLastSeen
  const date = new Date();
  //Make this datetime value
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  const sql = `UPDATE Sessions SET TimeLastUsed = ?, UserAgentLastSeen = ?, IPLastSeen = ? WHERE Cookie = ?`;
  await pool.query(sql, [datetime, req.headers["user-agent"], req.ip, cookie]);

  if (result.length == 0) {
    return null;
  }
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

async function CloudflareTurnStyle(token) {
  // "/siteverify" API endpoint.
  let formData = new FormData();
  formData.append("secret", process.env.CfTurnStyleSecret);
  formData.append("response", token);
  //formData.append("remoteip", ip);

  const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  const result = await fetch(url, {
    body: formData,
    method: "POST",
  });

  const outcome = await result.json();
  return outcome.success;
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

app.get("/SignUp", (req, res) => {
  res.sendFile(__dirname + "/Pages/signUp.html");
  Logs(req, 200);
});

app.get("/Login", (req, res) => {
  res.sendFile(__dirname + "/Pages/login.html");
  Logs(req, 200);
});

app.get("/Logout", (req, res) => {
  res.clearCookie("Auth");
  res.redirect("/");
  Logs(req, 200);
});

app.get("/myAccount", async (req, res) => {
  let UserID = await GetUserID(req.cookies.Auth, req);
  if (UserID == null) {
    res.redirect("/Login");
  } else {
    let [Sessions] = await pool.query(
      "SELECT ID,TimeCreated,TimeLastUsed,IPLastSeen,IPCreatedWith,UserAgentCreatedWith,UserAgentLastSeen FROM Sessions WHERE UserID = ? ORDER BY TimeLastUsed DESC LIMIT 5",
      [UserID]
    );
    const [CurrentSession] = await pool.query(
      "SELECT ID FROM Sessions WHERE Cookie = ?",
      [req.cookies.Auth]
    );
    //Add If the id of one of the sessions matches the current session then add a property called CurrentSession
    Sessions.forEach((session) => {
      if (session.ID == CurrentSession[0].ID) {
        session.CurrentSession = "(Current Session)";
      }
      //Format the ip addresses
      if (session.IPLastSeen == "::1") {
        session.IPLastSeen = "Localhost";
      } else {
        session.IPLastSeen = session.IPLastSeen.replace("::ffff:", "");
      }
      if (session.IPCreatedWith == "::1") {
        session.IPCreatedWith = "Localhost";
      } else {
        session.IPCreatedWith = session.IPCreatedWith.replace("::ffff:", "");
      }
      session.TimeCreated = session.TimeCreated.toLocaleString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      session.TimeLastUsed = session.TimeLastUsed.toLocaleString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    });
    res.render(__dirname + "/Pages/myAccount", { Sessions: Sessions });
    Logs(req, 200);
  }
});

//API responses
//General
app.get("/api/projects", async (req, res) => {
  const cookie = req.cookies;
  let sql;
  if (await Authorised(cookie["Auth"], pool)) {
    sql = "SELECT Time,Title,Appetizer,Status FROM Projects";
  } else {
    sql = `SELECT Time,Title,Appetizer,Status FROM Projects WHERE Status = 1`;
  }
  const [result] = await pool.query(sql);
  res.send(result);
  Logs(req, 200);
});

app.get("/projects/*", async (req, res) => {
  let project = req.path.split("/")[2];
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  let sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? AND Status = 1`;
  const [result] = await pool.query(sql, [project]);
  if (result.length == 0) {
    res.sendFile(__dirname + "/Pages/404.html");
    Logs(req, 404);
    return;
  }
  const UserID = await GetUserID(cookies["Auth"], req);
  sql = `SELECT count(*) FROM projectLikes WHERE UserID = ? AND Project = ?`;
  const [liked] = await pool.query(sql, [UserID, result[0].ID]);
  if (liked[0]["count(*)"] == 1) {
    result[0].Liked = true;
  } else {
    result[0].Liked = false;
  }
  sql = `SELECT Users.Username,Comments.Content,Comments.Likes,Comments.Unique_id FROM Comments,Users WHERE Comments.UserID=Users.ID AND Project = ? ORDER BY FIELD(Unique_id, ?) DESC, Likes DESC`;
  let [comments] = await pool.query(sql, [project, req.cookies.comment]);

  //If the user is logged in then check if they liked the comment
  if ((await GetUserID(req.cookies["Auth"], req)) != null) {
    const UserID = await GetUserID(req.cookies["Auth"], req);
    for (const comment of result) {
      sql = `SELECT count(*) FROM commentLikes WHERE UserID = ? AND Unique_id = ?`;
      const [liked] = await pool.query(sql, [UserID, comment.Unique_id]);
      if (liked[0]["count(*)"] == 1) {
        comment.Liked = true;
      } else {
        comment.Liked = false;
      }
    }
  }
  date = new Date(result[0].Time);
  date = date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  res.render(__dirname + "/Pages/article.ejs", {
    Title: result[0].Title,
    Content: result[0].Content,
    Appetizer: result[0].Appetizer,
    Time: date,
    Likes: result[0].Likes,
    Liked: result[0].Liked,
    Comments: comments,
  });
  Logs(req, 200);
});

app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "robots.txt"));
  Logs(req, 200);
});

app.get("/photos/:photo", (req, res) => {
  const photo = req.params.photo;
  res.sendFile(__dirname + "/Photos/" + photo);
  Logs(req, 200);
});

app.get("/api/projects/:project", async (req, res) => {
  Logs(req, 200);
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  let sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? AND Status = 1`;
  const [result] = await pool.query(sql, [project]);
  const UserID = await GetUserID(cookies["Auth"], req);
  sql = `SELECT count(*) FROM projectLikes WHERE UserID = ? AND Project = ?`;
  const [liked] = await pool.query(sql, [UserID, result[0].ID]);
  if (liked[0]["count(*)"] == 1) {
    result[0].Liked = true;
  } else {
    result[0].Liked = false;
  }
  res.send(result);
});

//Likes
app.get("/api/projects/:project/like", LikeLimit, async (req, res) => {
  //Check to see if the request can be dropped
  if (
    req.params.project == "" ||
    req.params.project == null ||
    req.params.project == undefined
  ) {
    res.sendStatus(400);
    Logs(req, 400);
    return;
  }
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  let UserID = await GetUserID(req.cookies["Auth"], req);
  //Get the project ID
  let sql = `SELECT ID FROM Projects WHERE Title = ?`;
  const [result] = await pool.query(sql, [project]);
  if (result.length == 0) {
    res.sendStatus(404);
    Logs(req, 404);
    return;
  }
  //Check to see if the user has liked the project
  sql = `SELECT count(*) FROM projectLikes WHERE UserID = ? AND Project = ?`;
  const [liked] = await pool.query(sql, [UserID, result[0].ID]);
  if (liked[0]["count(*)"] > 0) {
    //Remove the like
    sql = `DELETE FROM projectLikes WHERE UserID = ? AND Project = ?`;
    await pool.query(sql, [UserID, result[0].ID]);
    //Remove the like from the project
    sql = `UPDATE Projects SET Likes = Likes - 1 WHERE ID = ?`;
    await pool.query(sql, [result[0].ID]);
    res.send({ Status: "Removed" });
    Logs(req, 200);
  }
  if (liked[0]["count(*)"] < 1) {
    //Add the like
    sql = `INSERT INTO projectLikes (UserID,Project) VALUES (?,?)`;
    await pool.query(sql, [UserID, result[0].ID]);
    //Add the like to the project
    sql = `UPDATE Projects SET Likes = Likes + 1 WHERE ID = ?`;
    await pool.query(sql, [result[0].ID]);
    res.send({ Status: "Added" });
    Logs(req, 200);
  }
});

//Comments
app.post("/api/projects/:project/comment", CommentLimit, async (req, res) => {
  Logs(req, 204);
  if (req.body.comment == "" || req.params.project == "") {
    res.sendStatus(400);
    return;
  }
  if (req.body.comment == null || req.params.project == null) {
    res.sendStatus(400);
    return;
  }
  if (req.body.comment == undefined || req.params.project == undefined) {
    res.sendStatus(400);
    return;
  }
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

  const UserID = await GetUserID(req.cookies["Auth"], req);
  if (UserID == null) {
    res.sendStatus(401);
    return;
  }
  if (UserID == undefined) {
    res.sendStatus(401);
    return;
  }
  if (UserID.length == 0) {
    res.sendStatus(401);
    return;
  }
  const sql = `INSERT INTO Comments (Project,UserID,Content,Time,Likes,Unique_id) VALUES (?, ?, ?, ?, ?, ?)`;
  const values = [project, UserID, comment, datetime, 0, id];
  pool.query(sql, values);
  res.sendStatus(204);
});

app.get("/api/projects/:project/comments", async (req, res) => {
  Logs(req, 200);
  //Get the comments for the project
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  let sql = `SELECT UserID,Content,Likes,Unique_id FROM Comments Where Project = ? ORDER BY FIELD(Unique_id, ?) DESC, Likes DESC`;
  let [result] = await pool.query(sql, [project, req.cookies.comment]);
  //Convert the UserID to the username
  for (const comment of result) {
    sql = `SELECT Username FROM Users WHERE ID = ?`;
    const [user] = await pool.query(sql, [comment.UserID]);
    comment.Name = user[0].Username;
    delete comment.UserID;
  }
  //If the user is logged in then check if they liked the comment
  if ((await GetUserID(req.cookies["Auth"], req)) != null) {
    const UserID = await GetUserID(req.cookies["Auth"], req);
    for (const comment of result) {
      sql = `SELECT count(*) FROM commentLikes WHERE UserID = ? AND Unique_id = ?`;
      const [liked] = await pool.query(sql, [UserID, comment.Unique_id]);
      if (liked[0]["count(*)"] == 1) {
        comment.Liked = true;
      } else {
        comment.Liked = false;
      }
    }
  }
  res.send(result);
});

//Comment likes
app.get("/api/comments/:id/like", async (req, res) => {
  //Check to see if the request can be dropped
  if (
    req.params.id == "" ||
    req.params.id == null ||
    req.params.id == undefined
  ) {
    res.sendStatus(400);
    Logs(req, 400);
    return;
  }
  let id = req.params.id;
  id = id.replaceAll("-", " ");
  let UserID = await GetUserID(req.cookies["Auth"], req);
  //Check to see if the user has liked the project
  sql = `SELECT count(*) FROM commentLikes WHERE UserID = ? AND Unique_id = ?`;
  const [liked] = await pool.query(sql, [UserID, id]);
  if (liked[0]["count(*)"] > 0) {
    //Remove the like
    sql = `DELETE FROM commentLikes WHERE UserID = ? AND Unique_id = ?`;
    await pool.query(sql, [UserID, id]);
    //remove likes from the comment
    sql = `UPDATE Comments SET Likes = Likes - 1 WHERE Unique_id = ?`;
    await pool.query(sql, [id]);
    let [count] = await pool.query(
      "SELECT count(*) FROM commentLikes WHERE Unique_id = ?",
      [id]
    );
    res.send({ Status: count[0]["count(*)"] });
    Logs(req, 200);
  }
  if (liked[0]["count(*)"] < 1) {
    //Add the like
    sql = `INSERT INTO commentLikes (UserID,Unique_id) VALUES (?,?)`;
    await pool.query(sql, [UserID, id]);
    //Add likes to the comment
    sql = `UPDATE Comments SET Likes = Likes + 1 WHERE Unique_id = ?`;
    await pool.query(sql, [id]);
    let [count] = await pool.query(
      "SELECT count(*) FROM commentLikes WHERE Unique_id = ?",
      [id]
    );
    res.send({ Status: count[0]["count(*)"] });
    Logs(req, 200);
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

  if (await Authorised(password, pool)) {
    Logs(req, 200);
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
    await pool
      .query(sql, [datetime, title, appetizer, Content, tags, Status])
      .then(() => {
        res.send(
          `Successfully added project the visibility is set to ${Status}`
        );
      });
  } else {
    res.sendStatus(401);
    Logs(req, 401);
  }
});

app.post("/api/projects/:id/edit", async (req, res) => {
  const password = req.cookies.Auth;

  if (await Authorised(password, pool)) {
    Logs(req, 200);
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
    res.send("Successfully updated project");
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

//Management
app.get("/management", async (req, res) => {
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
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
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  if (Authorised(cookies["Auth"], pool)) {
    Logs(req, 204);
    //use mysql if statement if status = 1 then set to 0 else set to 1
    let sql = `UPDATE Projects SET Status = IF(Status = 1, 0, 1) WHERE title = ?`;
    pool.query(sql, [project]);
    res.sendStatus(204);
  }
});

//User accounts
app.post("/api/user/create", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const email = req.body.email;
  const cfTurnStyle = req.body["cf-turnstile-response"];
  CloudflareTurnStyle(cfTurnStyle).then(async (verdict) => {
    if (verdict == true) {
      //Check for the username existing
      let sql = "SELECT count(*) FROM Users WHERE Username = ?";
      const [result] = await pool.query(sql, [username]);
      if (result[0]["count(*)"] == 0) {
        Logs(req, 200);
        //check if username exists
        const passwordHash = crypto
          .createHash("sha256")
          .update(password)
          .digest("hex");
        sql = `INSERT INTO Users (Username, Password, Email) VALUES (?, ?, ?)`;
        pool.query(sql, [username, passwordHash, email]);
        res.send("Account created");
      } else {
        res.send("Username already exists");
        Logs(req, 409);
      }
    } else {
      res.send("Suspected bot");
      Logs(req, 403);
    }
  });
});

app.post("/api/user/login", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const cfTurnStyle = req.body["cf-turnstile-response"];
  CloudflareTurnStyle(cfTurnStyle).then(async (verdict) => {
    if (verdict == true) {
      const passwordHash = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
      let sql = `SELECT * FROM Users WHERE Username = ? AND Password = ?`;
      const [result] = await pool.query(sql, [username, passwordHash]);
      if (result.length == 1) {
        Logs(req, 200);
        //Make a cookie with the username current time and a random number
        const date = new Date();
        const datetime = date.toISOString().slice(0, 19).replace("T", " ");
        const cookie = crypto
          .createHash("sha256")
          .update(username + datetime + crypto.randomBytes(16).toString("hex"))
          .digest("hex");
        let IP = req.ip;
        if (process.env.PROXIED == "true") {
          IP = req.headers["x-forwarded-for"];
        }
        sql = `INSERT INTO Sessions (Cookie, UserID, TimeLastUsed,IPCreatedWith, IPLastSeen, UserAgentLastSeen, UserAgentCreatedWith) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(sql, [
          cookie,
          result[0].ID,
          datetime,
          IP,
          IP,
          req.headers["user-agent"],
          req.headers["user-agent"],
        ]);
        res.cookie("Auth", cookie);
        res.send("Logged in");
      } else {
        res.send("Incorrect username or password");
        Logs(req, 403);
      }
    } else {
      res.send("Suspected bot");
      Logs(req, 403);
    }
  });
});

app.get("/api/user", async (req, res) => {
  const cookie = req.cookies.Auth;
  let sql = `SELECT * FROM Sessions WHERE Cookie = ?`;
  let [result] = await pool.query(sql, [cookie]);
  if (result.length == 1) {
    Logs(req, 200);
    sql = `SELECT Username,Sudo FROM Users WHERE id = ?`;
    [result] = await pool.query(sql, [result[0].UserID]);
    res.send(result[0]);
  } else {
    res.sendStatus(204);
    Logs(req, 204);
  }
});

app.get("/api/user/sessions", async (req, res) => {
  const cookie = req.cookies.Auth;
  let UserID = await GetUserID(cookie, req);
  if (UserID != null) {
    Logs(req, 200);
    let sql = `SELECT TimeCreated,TimeLastUsed,IPCreatedWith,UserAgentCreatedWith,IPLastSeen,UserAgentLastSeen FROM Sessions WHERE UserID = ?`;
    const [result] = await pool.query(sql, [UserID]);
    res.send(result);
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});

//Make request to the like api
// This request will then be checked to see if the user has already liked the project
// If it has then it will remove the like and send back a different response code to if it hasnt liked it
// Meaning likes work as a toggle. This will work for ssr as the liked status doesn't need to be sent to the client
