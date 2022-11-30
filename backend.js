const express = require("express");
const app = express();
require("dotenv").config();
const fs = require("fs");
const path = require("path");
app.use(express.static(path.join(__dirname, "Pages")));
const mysql = require("mysql");
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
function CreateRead() {
  const readconnection = mysql.createConnection({
    host: process.env.DATABASEIP,
    user: process.env.DATABASEREADUSER,
    password: process.env.DATABASEPASSWORD,
    database: process.env.DATABASENAME,
  });
  readconnection.connect(function (err) {
    if (err) throw err;
  });
  return readconnection;
}

function CreateWrite() {
  const writeconnection = mysql.createConnection({
    host: process.env.DATABASEIP,
    user: process.env.DATABASEWRITEUSER,
    password: process.env.DATABASEPASSWORD,
    database: process.env.DATABASENAME,
  });
  writeconnection.connect(function (err) {
    if (err) throw err;
  });
  return writeconnection;
}

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
  writeLogs = CreateWrite();
  const sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode) VALUES ("${datetime}", "${ip}", "${forwardedfor}", "${useragent}", "${method}", "${path}", "${StatusCode}")`;
  writeLogs.query(sql, function (err, result) {
    if (err) throw err;
  });
  writeLogs.end();
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

//API responses
//General
app.get("/api/projects", (req, res) => {
  const cookie = req.cookies;
  let sql;
  if (cookie["Auth"] == process.env.ManagementToken) {
    sql = "SELECT Time,Title,Appetizer,Status FROM Projects";
  } else {
    sql = `SELECT Time,Title,Appetizer,Status FROM Projects WHERE Status = 1`;
  }
  const readconnection = CreateRead();
  readconnection.query(sql, function (err, result) {
    if (err) throw err;
    res.send(result);
    Logs(req, 200);
  });
  readconnection.end();
});

app.get("/api/projects/:project", async (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const readconnection = CreateRead();
  const cookies = req.cookies;
  let sql;
  if (cookies["Auth"] == process.env.ManagementToken) {
    sql = `SELECT * FROM Projects WHERE Title = ? AND Status = 1`;
  } else {
    sql = `SELECT ID,Time,Title,Appetizer,Content,Likes FROM Projects WHERE Title = ? AND Status = 1`;
  }
  readconnection.query(sql, [project], function (err, result) {
    if (err) throw err;
    if (result.length == 0) {
      res.sendStatus(404);
      Logs(req, 404);
    } else {
      res.send(result);
      Logs(req, 200);
    }
    readconnection.end();
  });
});

app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "robots.txt"));
  Logs(req, 200);
});

app.get("/photos/:photo", (req, res) => {
  try {
    var photo = req.params.photo;
    res.sendFile(__dirname + "/Photos/" + photo);
    Logs(req, 200);
  } catch (err) {
    console.log("/photos/:photo");
  }
});

//Likes
app.get("/api/projects/:project/like", (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const writeconnection = CreateWrite();
  let sql = `UPDATE Projects SET Likes = Likes + 1 WHERE Title = "${project}"`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

app.get("/api/projects/:project/dislike", (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  const writeconnection = CreateWrite();
  const sql = `UPDATE Projects SET Likes = Likes - 1 WHERE Title = "${project}"`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

//Comments
app.post("/api/projects/:project/comment", CommentLimit, (req, res) => {
  let project = req.params.project;
  project = project.replaceAll("-", " ");
  let comment = req.body.comment;
  let name = req.body.name;
  //Make sure that any " are replaced with ""
  comment = comment.replaceAll('"', '""');
  name = name.replaceAll('"', '""');
  //Get Current time as datetime
  const date = new Date();
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Create random id with letters and numbers
  const id =
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15);
  //Make sure that the comment is not empty and doesn't contain any html
  if (comment != "" && !comment.includes("<script>")) {
    if (req.body.email != "" && req.body.email != undefined) {
      const email = req.body.email;
      //Send Email With sendgrid
      const msg = {
        to: email,
        from: process.env.SENDER_EMAIL,
        subject: "Thanks for leaving a comment",
        text: `Hi ${name},\n\nThanks for leaving a comment on our website.The comment was:${comment} posted at:${datetime}`,
      };
      sgMail.send(msg);
      const sql = `INSERT INTO Comments (Time, Project, Name, Email, Content, unique_id, Likes) VALUES (?,?,?,?,?,?,?)`;
      const values = [datetime, project, name, email, comment, id, 0];
    } else {
      const sql = `INSERT INTO Comments (Time, Project, Name, Content, unique_id, Likes) VALUES (?,?,?,?,?,?)`;
      const values = [datetime, project, name, comment, id, 0];
    }
    const writeconnection = CreateWrite();
    writeconnection.query(sql, values, function (err, result) {
      if (err) throw err;
      res.cookie("comment", id, { maxAge: 900000, httpOnly: true });
      res.status(200).body(id);
      Logs(req, 200);
    });
    //Send response
  } else {
    res.sendStatus(400);
    Logs(req, 400);
  }
});

app.get("/api/projects/:project/comments", (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  const readconnection = CreateRead();
  //const sql = `SELECT Name,Content,Likes,Unique_id FROM Comments Where Project = "${project}" ORDER BY FIELD(Unique_id, "${req.cookies.comment}") DESC, Likes DESC`;
  //create prepared statement
  const sql = `SELECT Name,Content,Likes,Unique_id FROM Comments Where Project = ? ORDER BY FIELD(Unique_id, ?) DESC, Likes DESC`;
  readconnection.query(
    sql,
    [project, req.cookies.comment],
    function (err, result) {
      if (err) throw err;
      if (result.length > 0) {
        if (result[0].Unique_id == req.cookies.comment) {
          result[0].Name = result[0].Name + " (You)";
        }
      }
      res.send(result);
      readconnection.end();
      Logs(req, 200);
    }
  );
});

//Comment likes
app.get("/api/comments/:id/like", (req, res) => {
  var id = req.params.id;
  writeconnection = CreateWrite();
  sql = `UPDATE Comments SET Likes = Likes + 1 WHERE unique_id = "${id}"`;
  //Write to database
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

app.get("/api/comments/:id/dislike", (req, res) => {
  var id = req.params.id;
  writeconnection = CreateWrite();
  sql = `UPDATE Comments SET Likes = Likes - 1 WHERE unique_id = "${id}"`;
  //Write to database
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

//Post Data
app.post("/api/projects/new", (req, res) => {
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
    writeconnection = CreateWrite();
    sql = `INSERT INTO Projects (Time, Title, Appetizer, Content, Tags, Status, Likes) VALUES (?, ?, ?, ?, ?, ?, 0)`;
    writeconnection.query(
      sql,
      [datetime, title, appetizer, Content, tags, Status],
      function (err, result) {
        if (err) throw err;
        writeconnection.end();
        res.send(
          `Successfully added project the visibility is set to ${Status}`
        );
        Logs(req, 200);
      }
    );
  } else {
    res.send("Incorrect Password");
    Logs(req, 403);
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
    Content = Content.replaceAll('"', '""');
    tags = tags.replaceAll('"', '""');
    writeconnection = CreateWrite();
    //sql = `UPDATE Projects SET Title = "${title}", Appetizer = "${appetizer}", Content = "${Content}", Tags = "${tags}" WHERE id = ${id}`;
    //Rewrite statment to use prepared statements
    sql = `UPDATE Projects SET Title = ?, Appetizer = ?, Content = ?, Tags = ? WHERE id = ?`;
    writeconnection.query(
      sql,
      [title, appetizer, content, tags],
      function (err, result) {
        if (err) throw err;
        writeconnection.end();
        res.send(`Successfully edited project`);
        Logs(req, 200);
      }
    );
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

//Management
app.get("/management", (req, res) => {
  const Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    res.sendFile(__dirname + "/AdminPages/Management.html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
  }
});

app.get("/management/:Page", (req, res) => {
  const Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    res.sendFile(__dirname + "/AdminPages/" + req.params.Page + ".html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
  }
});

app.get("/api/showImages", (req, res) => {
  const Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    const fs = require("fs");
    var files = fs.readdirSync(__dirname + "/Photos");
    res.send(files);
    Logs(req, 200);
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

//Login
app.get("/login", (req, res) => {
  Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    res.redirect("/management");
    Logs(req, 302);
    return;
  }
  res.sendFile(__dirname + "/AdminPages/Login.html");
  Logs(req, 200);
});

app.post("/login", (req, res) => {
  let password = req.body.password;
  if (password == process.env.Password) {
    res.cookie("Auth", process.env.ManagementToken);
    res.redirect("/management");
    Logs(req, 200);
  } else {
    res.sendStatus(403);
    Logs(req, 403);
  }
});

app.post("/api/projects/:project/visibility", (req, res) => {
  const project = req.params.project;
  const cookies = req.cookies;
  if (cookies["Auth"] == process.env.ManagementToken) {
    writeconnection = CreateWrite();
    //use mysql if statement if status = 1 then set to 0 else set to 1
    sql = `UPDATE Projects SET Status = IF(Status = 1, 0, 1) WHERE title = ?`;
    writeconnection.query(sql, [project], function (err, result) {
      if (err) throw err;
      writeconnection.end();
      res.sendStatus(204);
      Logs(req, 204);
    });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});

//What the backend will need to acomplish
//Write logs to the database (done)
//Handle authentication and tokens
//Handle Passwords (Must get this right)
//Write new projects to the database
//Read the projects to the frontend
//Get the backend to send emails to users when they comment
//Respect weather a project is viewable or not
//Add an images folder that can be added to the pages by using an image tag in html
//Add a login screen that is the only way to access the management menu
//Add a way to delete projects
