const express = require("express");
const app = express();
require("dotenv").config();
const fs = require("fs");
const path = require("path");
app.use(express.static(path.join(__dirname, "Pages")));
const mysql = require("mysql");
//body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  var forwardedfor = req.headers["x-forwarded-for"];
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
  writeconnection = CreateWrite();
  sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode) VALUES ("${datetime}", "${ip}", "${forwardedfor}", "${useragent}", "${method}", "${path}", "${StatusCode}")`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
  });
  writeconnection.end();
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
  project = req.params[0];
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

//API responses
//General
app.get("/api/projects", (req, res) => {
  try {
    readconnection = CreateRead();
    sql = `SELECT Time,Title,Appetizer FROM Projects`;
    readconnection.query(sql, function (err, result) {
      if (err) throw err;
      res.send(result);
      Logs(req, 200);
    });
    readconnection.end();
  } catch (err) {
    console.log("/api/projects");
  }
});

app.get("/api/projects/:project", (req, res) => {
  try {
    var project = req.params.project;
    project = project.replaceAll("-", " ");
    readconnection = CreateRead();
    sql = `SELECT * FROM Projects WHERE Title = "${project}"`;
    readconnection.query(sql, function (err, result) {
      if (err) throw err;
      res.send(result);
      Logs(req, 200);
    });
    readconnection.end();
  } catch (err) {
    console.log("/api/projects/:project");
  }
});

app.get("/robots.txt", (req, res) => {
  res.sendFile(path.join(__dirname, "Pages", "robots.txt"));
  Logs(req, 200);
});

//Likes
app.get("/api/projects/:project/like", (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  writeconnection = CreateWrite();
  sql = `UPDATE Projects SET Likes = Likes + 1 WHERE Title = "${project}"`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

app.get("/api/projects/:project/dislike", (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  writeconnection = CreateWrite();
  sql = `UPDATE Projects SET Likes = Likes - 1 WHERE Title = "${project}"`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
    writeconnection.end();
    res.sendStatus(204);
    Logs(req, 204);
  });
});

//Comments
app.post("/api/projects/:project/comment", CommentLimit, (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  var comment = req.body.comment;
  var name = req.body.name;
  //Make sure that any " are replaced with ""
  comment = comment.replaceAll('"', '""');
  name = name.replaceAll('"', '""');
  //Get Current time as datetime
  const date = new Date();
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Make sure that the comment is not empty and doesn't contain any html
  if (comment != "" && !comment.includes("<script>")) {
    if (req.body.email != "") {
      var email = req.body.email;
      //Send Email With sendgrid
      const msg = {
        to: email,
        from: process.env.SENDER_EMAIL,
        subject: "Thanks for leaving a comment",
        text: `Hi ${name},\n\nThanks for leaving a comment on our website.The comment was:${comment} posted at:${datetime}`,
      };
      sgMail.send(msg);
      sql = `INSERT INTO Comments (Time, Project, Name, Email, Content, Likes) VALUES ("${datetime}", "${project}", "${name}", "${email}", "${comment}", 0)`;
    } else {
      sql = `INSERT INTO Comments (Time, Project, Name, Content, Likes) VALUES ("${datetime}", "${project}", "${name}", "${comment}", 0)`;
    }
    writeconnection = CreateWrite();
    writeconnection.query(sql, function (err, result) {
      if (err) throw err;
      writeconnection.end();
    });
    //Send response
    res.sendStatus(204);
    Logs(req, 204);
  } else {
    res.sendStatus(400);
    Logs(req, 400);
  }
});

app.get("/api/projects/:project/comments", (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  readconnection = CreateRead();
  sql = `SELECT Name,Content,Likes FROM Comments WHERE Project = "${project}"`;
  readconnection.query(sql, function (err, result) {
    if (err) throw err;
    res.send(result);
    Logs(req, 200);
    readconnection.end();
  });
});

//Post Data
app.post("/api/projects/new", (req, res) => {
  const password = req.body.password;
  var title = req.body.title;
  var appetizer = req.body.appetizer;
  var Content = req.body.content;
  var tags = req.body.tags;
  var Status = req.body.visibility;

  //Replace all " with ""
  title = title.replaceAll('"', '""');
  appetizer = appetizer.replaceAll('"', '""');
  Content = Content.replaceAll('"', '""');
  tags = tags.replaceAll('"', '""');

  if (password == process.env.PASSWORD) {
    //Send Email With sendgrid
    const msg = {
      to: process.env.EMAIL,
      from: process.env.SENDER_EMAIL,
      subject: "New Project Created",
      text: `Hello,\n\nSomeone has successfully created a new article on the website (tomblake.me) the details are: Title: ${title} Appetizer: ${appetizer} Content: ${Content} Tags: ${tags} Status: ${Status}`,
    };
    sgMail.send(msg);
    if ((Status = "Public")) {
      Status = 1;
    } else {
      Status = 0;
    }
    //Get current time as datetime
    const date = new Date();
    const datetime = date.toISOString().slice(0, 19).replace("T", " ");
    writeconnection = CreateWrite();
    sql = `INSERT INTO Projects (Time, Title, Appetizer, Content, Tags, Status, Likes) VALUES ("${datetime}", "${title}", "${appetizer}", "${Content}", "${tags}", "${Status}", 0)`;
    writeconnection.query(sql, function (err, result) {
      if (err) throw err;
      res.send(`Successfully added project the visibility is set to ${Status}`);
      Logs(req, 200);
      writeconnection.end();
    });
  } else {
    res.send("Incorrect Password");
    Logs(req, 403);
  }
});

//Deployment
app.get("/deployment/:Token", (req, res) => {
  var token = req.params.Token;
  if (token == process.env.DeploymentToken) {
    res.send("Deployment Successful");
    Logs(req, 200);
  } else {
    res.send("Deployment Failed");
    Logs(req, 403);
  }
  //run bash script
  const { exec } = require("child_process");
  exec("bash /home/ubuntu/Deploy.sh", (err, stdout, stderr) => {
    if (err) {
      //some err occurred
      console.error(err);
    } else {
      // the *entire* stdout and stderr (buffered)
      console.log(`stdout: ${stdout}`);
      console.log(`stderr: ${stderr}`);
    }
  });
});

app.get("/deployment", (req, res) => {
  res.send("Please provide a token");
  Logs(req, 400);
});

//Management
app.get("/management", (req, res) => {
  Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    res.sendFile(__dirname + "/AdminPages/Management.html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
  }
});

app.get("/management/CreateArticle", (req, res) => {
  Cookies = req.cookies;
  if (Cookies["Auth"] == process.env.ManagementToken) {
    res.sendFile(__dirname + "/AdminPages/CreateArticle.html");
    Logs(req, 200);
  } else {
    res.redirect("/login");
    Logs(req, 302);
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
  var password = req.body.password;
  if (password == process.env.Password) {
    res.cookie("Auth", process.env.ManagementToken);
    res.redirect("/management");
    Logs(req, 200);
  } else {
    res.sendStatus(403);
    Logs(req, 403);
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
