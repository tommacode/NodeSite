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

//Bad words
const Filter = require("bad-words");
const filter = new Filter();

//fileUpload
const fileUpload = require("express-fileupload");
app.use(
  fileUpload({
    createParentPath: true,
  })
);

//Image conversion
const Jimp = require("jimp");

//XML
const builder = require("xmlbuilder");

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
    connectionLimit: 50,
    host: process.env.DB_IP,
    user: process.env.DB_User,
    password: process.env.DB_Password,
    database: process.env.DB_Name,
  })
  .promise();

async function Logs(req, StatusCode, StartTime) {
  const date = new Date();

  const FinishTime = date.getTime();
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
  let useragent = req.headers["user-agent"];
  if (useragent == undefined) {
    useragent = "No User Agent";
  }
  if (useragent.length > 255) {
    useragent = useragent.slice(0, 255);
  }
  //Get Method
  const method = req.method;
  //Get Path
  const path = req.path;
  //Get Logged in user
  const cookie = req.cookies["Auth"];
  let Username;
  let UserID;
  if (cookie != undefined) {
    let sql = `SELECT Users.Username FROM Users,Sessions WHERE Sessions.UserID = Users.ID AND Sessions.Cookie = ?`;
    let [User] = await pool.query(sql, [cookie]);
    if (User.length == 0) {
      Username = "Not Logged In";
      UserID = 0;
    } else {
      Username = `User: ${User[0].Username}`;
      UserID = await GetUserID(cookie, req);
    }
  } else {
    Username = "Not Logged In";
    UserID = 0;
  }

  console.log(
    `${datetime} | ${ip} | ${forwardedfor} | ${useragent} | ${method} | ${path} | ${StatusCode} | ${Username} | ${
      FinishTime - StartTime
    }ms`
  );
  const sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode, User, ProcessTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const values = [
    datetime,
    ip,
    forwardedfor,
    useragent,
    method,
    path,
    StatusCode,
    UserID,
    FinishTime - StartTime,
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
  if (sudo.length == 0) {
    return false;
  }
  sudo = sudo[0].Sudo;
  return sudo == 1;
}

async function GetUserID(cookie, req) {
  if (cookie == undefined) {
    return null;
  }
  const [result] = await pool.query(
    "SELECT UserID FROM Sessions WHERE cookie = ?",
    [cookie]
  );
  const [Locked] = await pool.query("SELECT Locked FROM Users WHERE ID = ?", [
    result[0].UserID,
  ]);
  if (Locked[0].Locked == 1) {
    return null;
  }
  //Update lastused time, UserAgentLastSeen, IPLastSeen
  const date = new Date();
  //Make this datetime value
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  const sql = `UPDATE Sessions SET TimeLastUsed = ?, UserAgentLastSeen = ?, IPLastSeen = ? WHERE Cookie = ?`;
  let ip;
  if (process.env.PROXIED == "true") {
    ip = req.headers["x-forwarded-for"];
  } else {
    ip = req.ip;
  }
  await pool.query(sql, [datetime, req.headers["user-agent"], ip, cookie]);

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

function StandardChars(String) {
  const re = /^[a-zA-Z0-9 _-]+$/;
  return re.test(String);
}

async function CloudflareTurnStyle(token) {
  // "/siteverify" API endpoint.
  let formData = new FormData();
  formData.append("secret", process.env.CfTurnStyleSecret);
  formData.append("response", token);

  const url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  const result = await fetch(url, {
    body: formData,
    method: "POST",
  });

  const outcome = await result.json();
  return outcome.success;
}

async function ModifyProfilePictureCheck(UserID, pool) {
  const sql = `SELECT ModifyProfilePicture FROM Users WHERE ID = ?`;
  const [result] = await pool.query(sql, [UserID]);
  if (result.length == 0) {
    return false;
  }
  return result[0].ModifyProfilePicture == 1;
}

async function WriteComments(UserID, pool) {
  const sql = `SELECT WriteComments FROM Users WHERE ID = ?`;
  const [result] = await pool.query(sql, [UserID]);
  if (result.length == 0) {
    return false;
  }
  return result[0].WriteComments == 1;
}

async function Locked(UserID, pool) {
  const sql = `SELECT Locked FROM Users WHERE ID = ?`;
  const [result] = await pool.query(sql, [UserID]);
  if (result.length == 0) {
    return false;
  }
  return result[0].Locked == 1;
}
async function RefreshCacheArticles(Cache) {
  const sql = `SELECT ID, Title, Content FROM Projects WHERE Status = 1 ORDER BY ID DESC LIMIT 3`;
  let [Articles] = await pool.query(sql);
  for (let i = 0; i < Articles.length; i++) {
    //If the articles has <home> in it then remove it and </home> if it doesn't then remove the article and the title from the array
    if (Articles[i].Content.includes("<home>")) {
      //Console.log the character index okf the <home> tag
      Articles[i].Content =
        Articles[i].Content.split("<home>")[1].split("</home>")[0];
    } else {
      //Remove the Content, Title and ID from the array
      Articles.splice(i, 1);
    }
  }
  return Articles;
}
let Cache = [];
async function ShowResults() {
  Cache = await RefreshCacheArticles();
}

ShowResults();

//HTML responses
app.get("/", (req, res) => {
  const StartTime = new Date().getTime();
  res.render(__dirname + "/Pages/index.ejs", { Articles: Cache });
  Logs(req, 200, StartTime);
});

app.get("/projects", async (req, res) => {
  const StartTime = new Date().getTime();
  let sql = `SELECT ID, Title, Content, Appetizer, Time FROM Projects WHERE Status = 1 ORDER BY ID DESC`;
  let [Articles] = await pool.query(sql);
  for (let Article of Articles) {
    Article.Time = Article.Time.toLocaleString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  UserID = await GetUserID(req.cookies.Auth, req);
  if (UserID == null) {
    res.render(__dirname + "/Pages/NavPage.ejs", {
      User: false,
      Articles: Articles,
    });
    Logs(req, 200, StartTime);
    return;
  }
  sql = `SELECT count(*) FROM Views WHERE UserID = ?`;
  const [check] = await pool.query(sql, [UserID]);
  if (check[0]["count(*)"] == 0) {
    for (i = 0; i < Articles.length; i++) {
      Articles[i].Viewed = false;
    }
    res.render(__dirname + "/Pages/NavPage.ejs", {
      User: true,
      Articles: Articles,
    });
    Logs(req, 200, StartTime);
    return;
  }
  for (i = 0; i < Articles.length; i++) {
    sql = `SELECT count(*) FROM Views WHERE UserID = ? AND Project = ?`;
    const [view] = await pool.query(sql, [UserID, Articles[i].ID]);
    Articles[i].Viewed = view[0]["count(*)"] == 1;
  }
  res.render(__dirname + "/Pages/NavPage.ejs", {
    User: true,
    Articles: Articles,
  });
  Logs(req, 200, StartTime);
});

app.get("/Images", async (req, res) => {
  const StartTime = new Date().getTime();
  //TODO: Get a list of the images from the database that are added to the images page
  const [PhotoList] = await pool.query(
    "SELECT * FROM Photos WHERE Visibility = 1 ORDER BY ID DESC"
  );
  res.render(__dirname + "/Pages/Images.ejs", {
    PhotoList: PhotoList,
    None: false,
  });
  Logs(req, 200, StartTime);
});

app.get("/createArticle", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(path.join(__dirname, "Pages", "createArticle.html"));
  Logs(req, 200, StartTime);
});

app.get("/css.css", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/css.css");
  Logs(req, 200, StartTime);
});
app.get("/optionalStyling.css", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/optionalStyling.css");
  Logs(req, 200, StartTime);
});

app.get("/favicon.ico", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/favicon32.ico");
  Logs(req, 200, StartTime);
});

app.get("/SignUp", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/signUp.html");
  Logs(req, 200, StartTime);
});

app.get("/Login", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/login.html");
  Logs(req, 200, StartTime);
});

app.get("/Logout", (req, res) => {
  const StartTime = new Date().getTime();
  res.clearCookie("Auth");
  res.redirect("/");
  Logs(req, 200, StartTime);
});

app.get("/myAccount", async (req, res) => {
  const StartTime = new Date().getTime();
  let UserID = await GetUserID(req.cookies.Auth, req);
  if (UserID == null) {
    res.redirect("/Login");
    Logs(req, 302, StartTime);
  } else {
    let [Sessions] = await pool.query(
      "SELECT ID,TimeCreated,TimeLastUsed FROM Sessions WHERE UserID = ? ORDER BY TimeLastUsed DESC LIMIT 5",
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
    let [pfp] = await pool.query(
      "SELECT ProfilePicture, ProfilePictureLastUpdated FROM Users WHERE ID = ?",
      [UserID]
    );
    let RateLimit;
    if (!(await Authorised(req.cookies.Auth, pool))) {
      let LastUpdated = pfp[0].ProfilePictureLastUpdated;
      let currentTime = new Date().getTime();
      if (currentTime - LastUpdated > 10 * 60 * 1000) {
        RateLimit = false;
      } else {
        RateLimit = true;
      }
    } else {
      RateLimit = false;
    }
    res.render(__dirname + "/Pages/myAccount", {
      Sessions: Sessions,
      ProfilePicture: pfp[0].ProfilePicture,
      PfpRateLimit: RateLimit,
    });
    Logs(req, 200, StartTime);
  }
});

//API responses
//General
app.get("/api/projects", async (req, res) => {
  const StartTime = new Date().getTime();
  //This function is still needed for the management pages
  if ((await Authorised(req.cookies.Auth, pool)) == false) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
  const cookie = req.cookies;
  let sql;
  if (await Authorised(cookie["Auth"], pool)) {
    sql = "SELECT Time,Title,Appetizer,Status FROM Projects";
  } else {
    sql = `SELECT Time,Title,Appetizer,Status FROM Projects WHERE Status = 1`;
  }
  const [result] = await pool.query(sql);
  res.send(result);
  Logs(req, 200, StartTime);
});

app.get("/projects/*", async (req, res) => {
  const StartTime = new Date().getTime();
  let project = req.path.split("/");
  project.shift();
  project.shift();
  project = project.join("/");
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  let sql;
  //This check is still used on the management pages to show all articles
  if (await Authorised(cookies["Auth"], pool)) {
    sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? ORDER BY ID DESC`;
  } else {
    sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? AND Status = 1 ORDER BY ID DESC`;
  }
  const [result] = await pool.query(sql, [project]);
  if (result.length == 0) {
    //Send 404 status code and 404 page
    res.sendFile(__dirname + "/Pages/404.html");
    Logs(req, 404, StartTime);
    return;
  }
  const ProjectID = result[0].ID;
  const SudoUser = await Authorised(req.cookies.Auth, pool);
  let UserID = await GetUserID(req.cookies.Auth, req);
  if (SudoUser == false) {
    sql = `SELECT Users.Username,Users.Sudo,Comments.Content,Comments.Unique_id,ProfilePicture,Comments.Time,Users.ID,Comments.Deleted FROM Comments,Users WHERE Comments.UserID=Users.ID AND Project = ? AND DELETED = 0 ORDER BY Likes DESC LIMIT 100`;
  } else {
    sql = `SELECT Users.Username,Users.Sudo,Comments.Content,Comments.Unique_id,ProfilePicture,Comments.Time,Users.ID,Comments.Deleted,Comments.DeletedAt FROM Comments,Users WHERE Comments.UserID=Users.ID AND Project = ? ORDER BY Likes DESC LIMIT 100`;
  }
  let [comments] = await pool.query(sql, [ProjectID]);
  for (let i = 0; i < comments.length; i++) {
    try {
      comments[i].Content = filter.clean(comments[i].Content);
    } catch {
      comments[i].Content = "****";
    }

    if (comments[i].Sudo == 1) {
      comments[i].Username = "&lt " + comments[i].Username + " &gt";
    }
    delete comments[i].Sudo;
    //Change the time to a more readable format
    comments[i].Time = comments[i].Time.toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    //Find the number of likes for each comment
    sql = `SELECT count(*) FROM commentLikes WHERE Unique_id = ?`;
    [comments[i].Likes] = await pool.query(sql, [comments[i].Unique_id]);
    comments[i].Likes = comments[i].Likes[0]["count(*)"];
    if (comments[i].Deleted == 1) {
      comments[i].DeletedAt = comments[i].DeletedAt.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  let date = new Date(result[0].Time);
  date = date.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (UserID == null) {
    UserID = 0;
  }

  //Optimize this
  sql = `SELECT * FROM projectLikes WHERE Project = ? AND UserID = ?`;
  let [liked] = await pool.query(sql, [ProjectID, UserID]);
  let Liked;
  if (liked.length == 0) {
    Liked = false;
  } else {
    Liked = true;
  }
  //Find add liked: true or false to the comments if the user is logged in
  if (UserID != null && UserID != 0) {
    for (let i = 0; i < comments.length; i++) {
      sql = `SELECT * FROM commentLikes WHERE Unique_id = ? AND UserID = ?`;
      let [liked] = await pool.query(sql, [comments[i].Unique_id, UserID]);
      if (liked.length == 0) {
        comments[i].Liked = false;
      } else {
        comments[i].Liked = true;
      }
    }
    //If the user hasn't viewd the article before, add a view
    sql = `SELECT * FROM Views WHERE Project = ? AND UserID = ?`;
    let [viewed] = await pool.query(sql, [ProjectID, UserID]);
    if (viewed.length == 0) {
      sql = `INSERT INTO Views (Project,UserID) VALUES (?,?)`;
      pool.query(sql, [ProjectID, UserID]);
    }
  }
  //Replace <home> and </home> with ""
  result[0].Content = result[0].Content.replace("<home>", "");
  result[0].Content = result[0].Content.replace("</home>", "");
  result[0].Content = result[0].Content.replace(/""/g, /"/);

  res.render(__dirname + "/Pages/article.ejs", {
    Title: result[0].Title,
    Content: result[0].Content,
    Appetizer: result[0].Appetizer,
    Time: date,
    Liked: Liked,
    Likes: result[0].Likes,
    Comments: comments,
    UserID: UserID,
    SudoUser: SudoUser,
  });
  Logs(req, 200, StartTime);
});

app.get("/photos/:photo", (req, res) => {
  const StartTime = new Date().getTime();
  const photo = req.params.photo;
  res.setHeader("Expires", new Date(Date.now() + 86400000).toUTCString());
  res.sendFile(process.env.ArticlePhotosPath + photo);
  Logs(req, 200, StartTime);
});

app.get("/api/projects/:project", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await Authorised(req.cookies["Auth"], pool)) == false) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  let sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ?`;
  const [result] = await pool.query(sql, [project]);
  if (result.length == 0) {
    res.sendStatus(404);
    Logs(req, 404, StartTime);
    return;
  }
  //No need to check if the user has a valid session as they are already authorised
  const UserID = await GetUserID(cookies["Auth"], req);
  sql = `SELECT count(*) FROM projectLikes WHERE UserID = ? AND Project = ?`;
  const [liked] = await pool.query(sql, [UserID, result[0].ID]);
  if (liked[0]["count(*)"] == 1) {
    result[0].Liked = true;
  } else {
    result[0].Liked = false;
  }
  res.send(result);
  Logs(req, 200, StartTime);
});

//Likes
app.get("/api/projects/:project/like", LikeLimit, async (req, res) => {
  //Check to see if the request can be dropped
  const StartTime = new Date().getTime();
  //Validate the data to check for empty values
  if (
    req.params.project == "" ||
    req.params.project == null ||
    req.params.project == undefined
  ) {
    res.sendStatus(400);
    Logs(req, 400, StartTime);
    return;
  }
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  //Check to see if the user is logged in
  let UserID = await GetUserID(req.cookies["Auth"], req);
  if (UserID == null) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
  //Get the project ID
  let sql = `SELECT ID FROM Projects WHERE Title = ?`;
  const [result] = await pool.query(sql, [project]);
  if (result.length == 0) {
    res.sendStatus(404);
    Logs(req, 404, StartTime);
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
    Logs(req, 200, StartTime);
  }
  if (liked[0]["count(*)"] < 1) {
    //Add the like
    sql = `INSERT INTO projectLikes (UserID,Project) VALUES (?,?)`;
    await pool.query(sql, [UserID, result[0].ID]);
    //Add the like to the project
    sql = `UPDATE Projects SET Likes = Likes + 1 WHERE ID = ?`;
    await pool.query(sql, [result[0].ID]);
    res.send({ Status: "Added" });
    Logs(req, 200, StartTime);
  }
});

//Comments
app.post("/api/projects/:project/comment", async (req, res) => {
  const StartTime = new Date().getTime();
  const UserID = await GetUserID(req.cookies["Auth"], req);
  if (UserID == null) {
    res.send({ status: false, message: "You are not logged in" });
    Logs(req, 401, StartTime);
    return;
  }

  //Check if Settings.Existing_Users.CreateComments
  const data = fs.readFileSync(process.env.SettingsPath);
  const Settings = JSON.parse(data);
  if (Settings.Existing_Users.CreateComments == false) {
    res.send({
      status: false,
      message: "Comments have been temporarily disabled",
    });
    Logs(req, 403, StartTime);
    return;
  }

  if ((await WriteComments(UserID, pool)) == false) {
    res.send({
      status: false,
      message: "Writing comments has been disabled on your account",
    });
    Logs(req, 403, StartTime);
    return;
  }

  let query = "SELECT Locked FROM Users WHERE ID = ?";
  const [result] = await pool.query(query, [UserID]);
  if (result[0].Locked == 1) {
    res.clearCookie("Auth");
    res.send({ status: false, message: "Your account is locked" });
    Logs(req, 403, StartTime);
    return;
  }

  if (req.body.comment == "" || req.params.project == "") {
    res.send({
      status: false,
      message: "Comment is empty or on non existent article",
    });
    Logs(req, 400, StartTime);
    return;
  }
  let commentVar = req.body.comment;

  if (commentVar.length > 400) {
    res.send({ status: false, message: "Comment too long" });
    Logs(req, 400, StartTime);
    return;
  }
  if (req.body.comment == null || req.params.project == null) {
    res.send({
      status: false,
      message: "Comment is empty or on non existent article",
    });
    Logs(req, 400, StartTime);
    return;
  }
  if (req.body.comment == undefined || req.params.project == undefined) {
    res.send({
      status: false,
      message: "Comment is empty or on non existent article",
    });
    Logs(req, 400, StartTime);
    return;
  }
  //Change StartTime to be 10 minutes ago
  let Past = new Date().getTime() - 30000;
  //Change past to datetime
  Past = new Date(Past).toISOString().slice(0, 19).replace("T", " ");
  sql = `SELECT count(*) FROM Logs WHERE User = ? AND Path Like ? AND Time > ?`;
  const [count] = await pool.query(sql, [UserID, "%/comment", Past]);
  if (count[0]["count(*)"] > 2) {
    res.send({
      status: false,
      message: "You have commented too many times. Try again later.",
    });
    console.log("Rate limit reached by (" + UserID + ")");
    return;
  }
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  [project] = await pool.query(`SELECT ID FROM Projects WHERE Title = ?`, [
    project,
  ]);
  let comment = req.body.comment;
  //Get Current time as datetime
  const date = new Date();
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Create random id with letters and numbers
  const id =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  sql = `INSERT INTO Comments (Project,UserID,Content,Time,Likes,Unique_id) VALUES (?, ?, ?, ?, ?, ?)`;
  const values = [project[0].ID, UserID, comment, datetime, 0, id];
  pool.query(sql, values);
  res.send({ status: true, message: "Comment added" });
  Logs(req, 204, StartTime);
});

app.get("/api/projects/:project/comments", async (req, res) => {
  const StartTime = new Date().getTime();
  //Get the comments for the project
  if ((await Authorised(req.cookies["Auth"], req)) == false) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
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
  Logs(req, 200, StartTime);
});

app.get("/api/comments/delete/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  if (
    req.params.id == "" ||
    req.params.id == null ||
    req.params.id == undefined
  ) {
    res.sendStatus(400);
    Logs(req, 400, StartTime);
    return;
  }
  let id = req.params.id;
  id = id.replaceAll("-", " ");
  let UserID = await GetUserID(req.cookies["Auth"], req);
  if (UserID == null) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
  let sql = `SELECT UserID FROM Comments WHERE Unique_id = ?`;
  let [result] = await pool.query(sql, [id]);
  if (result.length == 0) {
    res.sendStatus(404);
    Logs(req, 404, StartTime);
    return;
  }
  if (
    result[0].UserID != UserID &&
    (await Authorised(req.cookies["Auth"], pool)) == false
  ) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
  const DeletionTime = new Date().toISOString().slice(0, 19).replace("T", " ");
  sql = `UPDATE Comments SET Deleted = 1, DeletedAt = ?, DeletedBy = ? WHERE Unique_id = ?`;
  pool.query(sql, [DeletionTime, UserID, id]);
  res.sendStatus(204);
  Logs(req, 204, StartTime);
});

app.get("/api/comments/restore/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await Authorised(req.cookies["Auth"], pool)) == false) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }

  await pool.query(`UPDATE Comments SET Deleted = 0 WHERE Unique_id = ?`, [
    req.params.id,
  ]);
  res.sendStatus(204);
  Logs(req, 204, StartTime);
});

//Comment likes
app.get("/api/comments/:id/like", async (req, res) => {
  const StartTime = new Date().getTime();
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
  if (UserID == null) {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
    return;
  }
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
    res.send({ Status: count[0]["count(*)"], Action: "Removed" });
    Logs(req, 200, StartTime);
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
    res.send({ Status: count[0]["count(*)"], Action: "Added" });
    Logs(req, 200, StartTime);
  }
});

//Post Data
app.post("/api/projects/new", async (req, res) => {
  const StartTime = new Date().getTime();
  const password = req.cookies.Auth;
  let title = req.body.title;
  let appetizer = req.body.appetizer;
  let Content = req.body.content;
  let tags = req.body.tags;
  let Status = req.body.visibility;
  if (Status == "Public") {
    Status = "1";
  } else {
    Status = "0";
  }

  ShowResults();

  if (await Authorised(password, pool)) {
    //Send Email With sendgrid
    const msg = {
      to: process.env.EMAIL,
      from: process.env.SENDER_EMAIL,
      subject: "New Project Created",
      text: `Hello,\n\nSomeone has successfully created a new article on the website (tomblake.me) the details are: Title: ${title} Appetizer: ${appetizer} Content: ${Content} Tags: ${tags} Status: ${Status}`,
    };
    sgMail.send(msg);
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
        Logs(req, 200, StartTime);
      });
  } else {
    res.sendStatus(401);
    Logs(req, 401, StartTime);
  }
});

app.post("/api/projects/:id/edit", async (req, res) => {
  const StartTime = new Date().getTime();
  const password = req.cookies.Auth;

  if (await Authorised(password, pool)) {
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
    Logs(req, 200, StartTime);
    ShowResults();
  } else {
    res.sendStatus(403);
    Logs(req, 403, StartTime);
  }
});

//Management
app.get("/management", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    //Get the total number of requests
    let sql = `SELECT count(*) FROM Logs`;
    let [RequestsCount] = await pool.query(sql);
    RequestsCount = RequestsCount[0]["count(*)"];
    //Get the average process time of the requests
    sql = `SELECT ProcessTime FROM Logs ORDER BY Time DESC LIMIT 100`;
    let [ProcessTime] = await pool.query(sql);
    let TotalProcessTime = 0;
    for (let i = 0; i < ProcessTime.length; i++) {
      TotalProcessTime += ProcessTime[i]["ProcessTime"];
    }
    let AverageProcessTime = TotalProcessTime / ProcessTime.length;
    AverageProcessTime = Math.round(AverageProcessTime * 100) / 100;
    //Average number of requests per second
    Past = StartTime - 10000;
    Past = new Date(Past).toISOString().slice(0, 19).replace("T", " ");
    sql = `SELECT count(*) FROM Logs WHERE Time > ?`;
    let [PastCount] = await pool.query(sql, [Past]);
    PastCount = PastCount[0]["count(*)"];
    let AverageRequestsPerSecond = PastCount / 10;
    AverageRequestsPerSecond = Math.round(AverageRequestsPerSecond * 100) / 100;

    //Read settings.json and parse json
    let settings = fs.readFileSync(process.env.SettingsPath);
    settings = JSON.parse(settings);
    res.render(__dirname + "/AdminPages/management.ejs", {
      LockAccounts: "(" + settings.New_Users.LockonCreate + ")",
      NewComments: "(" + settings.Existing_Users.CreateComments + ")",
      ChangePfp: "(" + settings.Existing_Users.ChangePfp + ")",
      Requests: RequestsCount,
      AverageProcessTime: AverageProcessTime,
      AverageRequestsPerSecond: AverageRequestsPerSecond,
    });
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/management/createArticle", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    Images = fs.readdirSync(process.env.ArticlePhotosPath);
    res.render(__dirname + "/AdminPages/createArticle.ejs", { Images: Images });
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/management/manageUsers", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let sql = `SELECT Username, Email, id, ProfilePicture, ModifyProfilePicture, WriteComments, Sudo, Time, Locked FROM Users ORDER BY Sudo DESC`;
    let [Users] = await pool.query(sql);

    for (i = 0; i < Users.length; i++) {
      let sql = `SELECT count(*) FROM Sessions WHERE UserID = ?`;
      let [count] = await pool.query(sql, [Users[i].id]);
      Users[i].Sessions = count[0]["count(*)"];

      sql = `SELECT count(*) FROM Comments WHERE UserID = ?`;
      [count] = await pool.query(sql, [Users[i].id]);
      Users[i].Comments = count[0]["count(*)"];

      sql = `SELECT count(*) FROM projectLikes WHERE UserID = ?`;
      [count] = await pool.query(sql, [Users[i].id]);
      Users[i].Likes = count[0]["count(*)"];

      sql = `SELECT TimeLastUsed FROM Sessions WHERE UserID = ? ORDER BY TimeLastUsed DESC LIMIT 1`;
      [count] = await pool.query(sql, [Users[i].id]);
      if (count.length == 0) {
        Users[i].LastUsed = "Never";
      } else {
        Users[i].LastUsed = count[0].TimeLastUsed;
        Users[i].LastUsed = Users[i].LastUsed.toLocaleString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
          second: "numeric",
        });
      }

      //Make the sign up to locale string
      Users[i].Time = Users[i].Time.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });

      //Change 0 and 1 to true and false
      if (Users[i].ModifyProfilePicture == 1) {
        Users[i].ModifyProfilePicture = "True";
      } else {
        Users[i].ModifyProfilePicture = "False";
      }
      if (Users[i].WriteComments == 1) {
        Users[i].WriteComments = "True";
      } else {
        Users[i].WriteComments = "False";
      }
      if (Users[i].Locked == 1) {
        Users[i].Locked = "True";
      } else {
        Users[i].Locked = "False";
      }

      if (Users[i].Sudo == 1) {
        Users[i].Username = "&lt " + Users[i].Username + " &gt";
      }
    }
    res.render(__dirname + "/AdminPages/manageUsers.ejs", { Users: Users });
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/management/manageUser/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    res.render(__dirname + "/AdminPages/manageUser.ejs");
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/management/managePhotos", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let Images = fs.readdirSync(process.env.ArticlePhotosPath);
    let allowedExtensions = [".jpg", ".png", ".jpeg"];
    for (i = 0; i < Images.length; i++) {
      let ext = path.extname(Images[i]);
      if (!allowedExtensions.includes(ext)) {
        Images.splice(i, 1);
        i--;
      }
    }
    const [result] = await pool.query(`SELECT * FROM Photos`);
    let ImageData = result;
    for (i = 0; i < ImageData.length; i++) {
      if (Images.indexOf(ImageData[i].Path) != -1) {
        Images.splice(Images.indexOf(ImageData[i].Path), 1);
      }
    }
    res.render(__dirname + "/AdminPages/ManagePhotos.ejs", {
      Images: Images,
      ImageData: ImageData,
    });
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/api/management/ModifyProfilePicture/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let id = req.params.id;
    let sql = `SELECT ModifyProfilePicture FROM Users WHERE id = ?`;
    let [result] = await pool.query(sql, [id]);
    if (result[0].ModifyProfilePicture == 1) {
      sql = `UPDATE Users SET ModifyProfilePicture = 0 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "False" });
      Logs(req, 200, StartTime);
    } else {
      sql = `UPDATE Users SET ModifyProfilePicture = 1 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "True" });
      Logs(req, 200, StartTime);
    }
  }
});

app.get("/api/management/WriteComments/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let id = req.params.id;
    let sql = `SELECT WriteComments FROM Users WHERE id = ?`;
    let [result] = await pool.query(sql, [id]);
    if (result[0].WriteComments == 1) {
      sql = `UPDATE Users SET WriteComments = 0 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "False" });
      Logs(req, 200, StartTime);
    } else {
      sql = `UPDATE Users SET WriteComments = 1 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "True" });
      Logs(req, 200, StartTime);
    }
  }
});

app.get("/api/management/DeletePfp/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let id = req.params.id;
    let sql = `SELECT ProfilePicture FROM Users WHERE id = ?`;
    let [result] = await pool.query(sql, [id]);
    if (result[0].ProfilePicture != "0") {
      fs.unlinkSync(process.env.AvatarPath + result[0].ProfilePicture + ".png");
      sql = `UPDATE Users SET ProfilePicture = 0 WHERE id = ?`;
      pool.query(sql, [id]);
      res.sendStatus(200);
      Logs(req, 200, StartTime);
    }
  } else {
    res.sendStatus(400);
    Logs(req, 400, StartTime);
  }
});

app.get("/api/management/LockAccount/:id", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    let id = req.params.id;
    let sql = `SELECT Locked FROM Users WHERE id = ?`;
    let [result] = await pool.query(sql, [id]);
    if (result[0].Locked == 1) {
      sql = `UPDATE Users SET Locked = 0 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "False" });
      Logs(req, 200, StartTime);
    } else {
      sql = `UPDATE Users SET Locked = 1 WHERE id = ?`;
      await pool.query(sql, [id]);
      res.send({ status: "Success", mode: "True" });
      Logs(req, 200, StartTime);
    }
  }
});

app.get("/management/:Page", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    res.sendFile(__dirname + "/AdminPages/" + req.params.Page + ".html");
    Logs(req, 200, StartTime);
  } else {
    res.redirect("/login");
    Logs(req, 302, StartTime);
  }
});

app.get("/api/showImages", async (req, res) => {
  const StartTime = new Date().getTime();
  const Cookies = req.cookies;
  if (await Authorised(Cookies["Auth"], pool)) {
    const files = fs.readdirSync(process.env.ArticlePhotosPath);
    res.send(files);
    Logs(req, 200, StartTime);
  } else {
    res.sendStatus(403);
    Logs(req, 403, StartTime);
  }
});

//Login
app.get("/login", (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/login.html");
  Logs(req, 200, StartTime);
});

app.post("/api/projects/:project/visibility", (req, res) => {
  const StartTime = new Date().getTime();
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const cookies = req.cookies;
  if (Authorised(cookies["Auth"], pool)) {
    //use mysql if statement if status = 1 then set to 0 else set to 1
    let sql = `UPDATE Projects SET Status = IF(Status = 1, 0, 1) WHERE title = ?`;
    pool.query(sql, [project]);
    res.sendStatus(204);
    Logs(req, 204, StartTime);
    ShowResults();
  }
});

//User accounts
app.post("/api/user/create", async (req, res) => {
  const StartTime = new Date().getTime();
  const username = req.body.username;
  const password = req.body.password;
  const confirmPassword = req.body.confirmPassword;
  const email = req.body.email;
  //Validate the data
  if (username.length < 3 || username.length > 16) {
    res.send("Username must be at least 3-16 characters long");
    Logs(req, 400, StartTime);
    return;
  } else if (password.length < 8 || password.length > 32) {
    res.send("Password must be at least 8-32 characters long");
    Logs(req, 400, StartTime);
    return;
  } else if (ValidateEmail(email) == false) {
    res.send("Invalid email");
    Logs(req, 400, StartTime);
    return;
  } else if (StandardChars(username) == false) {
    res.send("Usename can only contain letters, numbers, spaces, - and _");
    Logs(req, 400, StartTime);
    return;
  } else if (password != confirmPassword) {
    res.send("Passwords do not match");
    Logs(req, 400, StartTime);
    return;
  } else if (email.length > 254) {
    res.send("Email is too long");
    Logs(req, 400, StartTime);
    return;
  } else if (username != filter.clean(username)) {
    res.send("Username contains banned words");
    Logs(req, 400, StartTime);
    return;
  }
  // Check if username is taken
  let sql = `SELECT count(*) FROM Users WHERE Username = ? OR Email = ?`;
  let [result] = await pool.query(sql, [username, email]);
  if (result[0]["count(*)"] > 0) {
    res.send("Username or email is already taken");
    Logs(req, 400, StartTime);
    return;
  }

  //Read and parse json file
  const data = fs.readFileSync(process.env.SettingsPath);
  const settings = JSON.parse(data);
  let Locked = 0;
  if (settings.New_Users.LockonCreate == true) {
    Locked = 1;
  }

  const cfTurnStyle = req.body["cf-turnstile-response"];
  CloudflareTurnStyle(cfTurnStyle).then(async (verdict) => {
    if (verdict == true) {
      const passwordHash = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
      sql = `INSERT INTO Users (Username, Password, Email, Locked) VALUES (?, ?, ?, ?)`;
      await pool.query(sql, [username, passwordHash, email, Locked]);
      //Get the id of the user
      sql = `SELECT id FROM Users WHERE Username = ?`;
      const [UserID] = await pool.query(sql, [username]);
      //Create verification id
      const VerificationID = crypto.randomBytes(16).toString("hex");
      sql = `INSERT INTO VerifyEmail (UserID, Code) VALUES (?, ?)`;
      pool.query(sql, [UserID[0].id, VerificationID]);
      //Send email
      if (settings.New_Users.SendEmail == true) {
        const msg = {
          from: process.env.SENDER_EMAIL,
          to: email,
          subject: "Verify Your Email",
          htmlT: `<!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta http-equiv="X-UA-Compatible" content="IE=edge" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            </head>
            <body>
              <center>
                <h1>Verify Your Email</h1>
                <br />
                <p>Click the link to verify your email address</p>
                <br />
                <a href="${process.env.Protocol}://${process.env.Domain}/Verify/${VerificationID}">Verify Email</a>
              </center>
            </body>
          </html>`,
        };
        sgMail.send(msg);
      }
      res.send(
        "Account created. Please check your email to verify your account before logging in."
      );
      Logs(req, 200, StartTime);
    } else {
      res.send("Suspected bot");
      Logs(req, 403, StartTime);
    }
  });
});

app.post("/api/user/login", async (req, res) => {
  const StartTime = new Date().getTime();
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
        if (result[0].Locked == 1) {
          res.send("Account is locked");
          Logs(req, 403, StartTime);
          return;
        }
        if (result[0].EmailVerified == 0) {
          res.send("Verify your email before logging in");
          Logs(req, 403, StartTime);
          return;
        }
        Logs(req, 200, StartTime);
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
        Logs(req, 403, StartTime);
      }
    } else {
      res.send("Suspected bot");
      Logs(req, 403, StartTime);
    }
  });
});

app.get("/api/user", async (req, res) => {
  const StartTime = new Date();
  const cookie = req.cookies.Auth;
  res.set("Cache-Control", "private, max-age=5");
  let sql = `SELECT * FROM Sessions WHERE Cookie = ?`;
  let [result] = await pool.query(sql, [cookie]);
  if (result.length == 1) {
    sql = `SELECT Username,Sudo,ModifyProfilePicture,WriteComments,Locked FROM Users WHERE ID = ?`;
    [result] = await pool.query(sql, [result[0].UserID]);
    if (result.length == 0) {
      res.sendStatus(204);
      Logs(req, 204, StartTime);
      return;
    }
    if (result[0].Locked == 1) {
      res.clearCookie("Auth");
      res.send(result[0]);
      return;
    }
    res.send(result[0]);
    Logs(req, 200, StartTime);
  } else {
    res.sendStatus(204);
    Logs(req, 204, StartTime);
  }
});

app.get("/Verify/*", async (req, res) => {
  const StartTime = new Date().getTime();
  res.sendFile(__dirname + "/Pages/Verify.html");
  Logs(req, 200, StartTime);
});

app.post("/api/user/verify", async (req, res) => {
  const StartTime = new Date().getTime();
  const code = req.body.VerificationID;
  let sql = `SELECT UserID FROM VerifyEmail WHERE Code = ?`;
  let [UserID] = await pool.query(sql, [code]);
  if (UserID.length == 0) {
    res.send("Invalid code");
    Logs(req, 403, StartTime);
    return;
  }
  UserID = UserID[0].UserID;
  sql = `UPDATE Users SET EmailVerified = 1 WHERE ID = ?`;
  pool.query(sql, [UserID]);
  sql = `DELETE FROM VerifyEmail WHERE Code = ?`;
  pool.query(sql, [code]);
  res.sendStatus(200);
  Logs(req, 200, StartTime);
});

app.post("/api/upload/articlePhotos", async (req, res) => {
  const StartTime = new Date().getTime();
  if (Authorised(req.cookies["Auth"], pool) == false) {
    res.send({ status: false, message: "Not authorised" });
    Logs(req, 403, StartTime);
    return;
  }
  if (!req.files) {
    res.send({
      status: false,
      message: "No file uploaded",
    });
  } else {
    //Use the name of the input field (i.e. "Image") to retrieve the uploaded file
    let Image = req.files.Image;

    let Name = req.body.Name;
    if (Name == null || Name == "" || Name == undefined) {
      Name = Image.name;
    } else {
      let ImageFormat = Image.name.split(".").pop();
      Name = Name.replace(/ /g, "") + "." + ImageFormat.toLowerCase();
    }
    //Use the mv() method to place the file in the upload directory (i.e. "uploads")
    Image.mv(process.env.ArticlePhotosPath + Name);

    if (
      Image.mimetype != "image/png" &&
      Image.mimetype != "image/jpeg" &&
      Image.mimetype != "image/jpg"
    ) {
      res.status(400).send({
        status: false,
        message: "File is not a image. Only jpg, jpeg and png format allowed",
      });
      Logs(req, 400, StartTime);
      return;
    }

    //send response
    res.sendStatus(204);
    Logs(req, 204, StartTime);
  }
});

app.post("/api/addImageData", async (req, res) => {
  const StartTime = new Date().getTime();
  if (Authorised(req.cookies["Auth"], pool) == false) {
    res.send({ status: false, message: "Not authorised" });
    Logs(req, 403, StartTime);
    return;
  }
  let sql =
    "INSERT INTO Photos (Path, Name, Location, Description, Visibility) VALUES (?, ?, ?, ?, 1)";
  await pool.query(sql, [
    req.body.FileName,
    req.body.Name,
    req.body.Location,
    req.body.Description,
  ]);
  res.send("ok");
});

app.post("/api/changeImageVisibility", async (req, res) => {
  const StartTime = new Date().getTime();
  if (Authorised(req.cookies["Auth"], pool) == false) {
    res.send({ status: false, message: "Not authorised" });
    Logs(req, 403, StartTime);
    return;
  }
  let sql =
    "UPDATE Photos SET Visibility = IF(Visibility = 1, 0, 1) WHERE Path = ?";
  await pool.query(sql, [req.body.FileName]);
  let [result] = await pool.query(
    "SELECT Visibility FROM Photos WHERE Path = ?",
    [req.body.FileName]
  );
  if (result[0].Visibility == 1) {
    res.send({ success: true, visibility: "Visible" });
    Logs(req, 200, StartTime);
  } else {
    res.send({ success: true, visibility: "Hidden" });
    Logs(req, 200, StartTime);
  }
});

app.post("/api/upload/pfp", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await GetUserID(req.cookies["Auth"], req)) == null) {
    res.send({ status: false, message: "Not authorised" });
    Logs(req, 403, StartTime);
    return;
  } else {
    const UserID = await GetUserID(req.cookies["Auth"], req);
    if ((await ModifyProfilePictureCheck(UserID, pool)) == false) {
      res.send({
        status: "false",
        message:
          "Modifying your profile picture has been disabled on your account",
      });
      Logs(req, 403, StartTime);
      return;
    }
    if (!req.files) {
      res.send({ status: false, message: "No file uploaded" });
      Logs(req, 400, StartTime);
      return;
    }
    if (req.files.file.size > 2 * 1024 * 1024) {
      res.send({ status: false, message: "File can't be larger than 2MB" });
      Logs(req, 400, StartTime);
      return;
    }
    let Image = req.files.file;

    if (
      Image.mimetype != "image/png" &&
      Image.mimetype != "image/jpeg" &&
      Image.mimetype != "image/jpg"
    ) {
      res.status(400).send({
        status: false,
        message: "File is not a image. Only jpg, jpeg and png format allowed",
      });
      Logs(req, 400, StartTime);
      return;
    }
    if ((await Authorised(req.cookies["Auth"], pool)) == false) {
      let LastUpdated = pfp[0].ProfilePictureLastUpdated;
      let currentTime = new Date().getTime();
      let RateLimit;
      if (currentTime - LastUpdated < 10 * 60 * 1000) {
        res.send({
          status: false,
          message: "You can only change your profile picture every 10 minutes",
        });
        Logs(req, 400, StartTime);
        return;
      }
    }

    //By here we have established the file is valid
    const [PFPID] = await pool.query(
      "SELECT ProfilePicture FROM Users WHERE ID = ?",
      [UserID]
    );
    //This allows the new profile picture to inherit the file name of the old one
    let PictureID = PFPID[0].ProfilePicture;
    if (PictureID == 0) {
      PictureID = crypto.randomBytes(16).toString("hex");
      pool.query("UPDATE Users SET ProfilePicture = ? WHERE ID = ?", [
        PictureID,
        UserID,
      ]);
    }
    //Get current time in datetime format
    const CurrentTime = new Date().toISOString().slice(0, 19).replace("T", " ");
    pool.query("UPDATE Users SET ProfilePictureLastUpdated = ? WHERE ID = ?", [
      CurrentTime,
      UserID,
    ]);
    let fileType = Image.mimetype.split("/")[1];
    //Convert to png if not already
    if (fileType != "png") {
      fileType = "png";
      const image = await Jimp.read(Image.data);
      Image.data = await image.getBufferAsync(Jimp.MIME_PNG);
    }
    //Use the mv() method to place the file in the upload directory (i.e. "uploads")
    Image.mv(process.env.AvatarPath + PictureID + ".png");
    res.sendStatus(204);
    Logs(req, 204, StartTime);
  }
});

app.post("/api/remove/pfp", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await GetUserID(req.cookies["Auth"], req)) == null) {
    res.send({ status: false, message: "Not authorised" });
    Logs(req, 403, StartTime);
    return;
  } else {
    const UserID = await GetUserID(req.cookies["Auth"], req);
    const [PFPID] = await pool.query(
      "SELECT ProfilePicture FROM Users WHERE ID = ?",
      [UserID]
    );
    let PictureID = PFPID[0].ProfilePicture;
    if (PictureID != 0) {
      fs.unlink(process.env.AvatarPath + PictureID + ".png", (err) => {
        if (err) {
          console.error(err);
          return;
        }
      });
      pool.query("UPDATE Users SET ProfilePicture = 0 WHERE ID = ?", [UserID]);
    }
    res.sendStatus(204);
    Logs(req, 204, StartTime);
  }
});

app.get("/api/avatar/:pfp", async (req, res) => {
  const StartTime = new Date().getTime();
  const pfp = req.params.pfp;
  //add expires header for 5 minutes
  res.set("Expires", new Date(Date.now() + 5 * 60 * 1000).toUTCString());
  //check if the image exists
  if (!fs.existsSync(process.env.AvatarPath + pfp + ".png")) {
    res.sendFile(process.env.AvatarPath + "0.png");
    Logs(req, 404, StartTime);
    return;
  }
  res.sendFile(process.env.AvatarPath + pfp + ".png");
  Logs(req, 200, StartTime);
});

//Quick Actions Api
app.get("/api/quickActions/LockonCreate", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await Authorised(req.cookies["Auth"], pool)) == true) {
    const data = fs.readFileSync(process.env.SettingsPath);
    const Settings = JSON.parse(data);
    if (Settings.New_Users.LockonCreate == false) {
      //Enables lock on create
      Settings.New_Users.LockonCreate = true;
      res.send({ status: true, error: false });
      fs.writeFileSync(process.env.SettingsPath, JSON.stringify(Settings));
      Logs(req, 200, StartTime);
    } else {
      //Disables lock on create
      Settings.New_Users.LockonCreate = false;
      res.send({ status: false, error: false });
      fs.writeFileSync(process.env.SettingsPath, JSON.stringify(Settings));
      Logs(req, 200, StartTime);
    }
  } else {
    res.send({ status: false, error: true, message: "Not an admin" });
    Logs(req, 401, StartTime);
  }
});

app.get("/api/quickActions/CommentCreation", async (req, res) => {
  const StartTime = new Date().getTime();
  if ((await Authorised(req.cookies["Auth"], pool)) == true) {
    const data = fs.readFileSync(process.env.SettingsPath);
    const Settings = JSON.parse(data);
    if (Settings.Existing_Users.CreateComments == false) {
      //Enables lock on create
      Settings.Existing_Users.CreateComments = true;
      res.send({ status: true, error: false });
      fs.writeFileSync(process.env.SettingsPath, JSON.stringify(Settings));
      Logs(req, 200, StartTime);
    } else {
      //Disables lock on create
      Settings.Existing_Users.CreateComments = false;
      res.send({ status: false, error: false });
      fs.writeFileSync(process.env.SettingsPath, JSON.stringify(Settings));
      Logs(req, 200, StartTime);
    }
  } else {
    res.send({ status: false, error: true, message: "Not an admin" });
    Logs(req, 401, StartTime);
  }
});

app.get("/TermsOfService", (req, res) => {
  const StartTime = new Date().getTime();
  res.render(__dirname + "/Pages/TermsOfService.ejs");
  Logs(req, 200, StartTime);
});

app.get("/PrivacyPolicy", (req, res) => {
  const StartTime = new Date().getTime();
  res.render(__dirname + "/Pages/PrivacyPolicy.ejs");
  Logs(req, 200, StartTime);
});

app.get("/sitemap.xml", async (req, res) => {
  const StartTime = new Date().getTime();
  //Use xml builder to create the sitemap
  const sitemap = builder.create("urlset", { version: "1.0" });
  sitemap.att("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9");

  //Add the home page
  sitemap
    .ele("url")
    .ele("loc", `${process.env.Protocol}://${process.env.Domain}/`);
  sitemap
    .ele("url")
    .ele("loc", `${process.env.Protocol}://${process.env.Domain}/login`);
  sitemap
    .ele("url")
    .ele("loc", `${process.env.Protocol}://${process.env.Domain}/SignUp`);
  sitemap
    .ele("url")
    .ele("loc", `${process.env.Protocol}://${process.env.Domain}/projects`);
  let sql = "SELECT Title FROM Projects WHERE Status = 1";
  const [results] = await pool.query(sql);
  for (let i = 0; i < results.length; i++) {
    sitemap
      .ele("url")
      .ele(
        "loc",
        `${process.env.Protocol}://${process.env.Domain}/projects/${results[
          i
        ].Title.replace(/ /g, "-")}`
      );
  }
  res.header("Content-Type", "application/xml");
  res.send(sitemap.end({ pretty: true }));
  Logs(req, 200, StartTime);
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});
