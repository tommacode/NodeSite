const express = require("express");
const app = express();
require("dotenv").config();
const fs = require("fs");
const path = require("path");
app.use(express.static(path.join(__dirname, "Pages")));
const mysql = require("mysql");
const readconnection = mysql.createConnection({
  host: process.env.DATABASEIP,
  user: process.env.DATABASEREADUSER,
  password: process.env.DATABASEPASSWORD,
  database: process.env.DATABASENAME,
});
const writeconnection = mysql.createConnection({
  host: process.env.DATABASEIP,
  user: process.env.DATABASEWRITEUSER,
  password: process.env.DATABASEPASSWORD,
  database: process.env.DATABASENAME,
});
readconnection.connect(function (err) {
  if (err) throw err;
});
writeconnection.connect(function (err) {
  if (err) throw err;
});

function Logs(req, StatusCode) {
  const date = new Date();
  //Change date to datetime value
  const datetime = date.toISOString().slice(0, 19).replace("T", " ");
  //Get IP
  const ip = req.connection.remoteAddress;
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
  sql = `INSERT INTO Logs (Time, ip, forwardedfor, useragent, method, path, statuscode) VALUES ("${datetime}", "${ip}", "${forwardedfor}", "${useragent}", "${method}", "${path}", "${StatusCode}")`;
  writeconnection.query(sql, function (err, result) {
    if (err) throw err;
  });
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

//JSON or text responses
app.get("/api/projects", (req, res) => {
  sql = `SELECT Time,Title,Appetizer FROM Projects`;
  readconnection.query(sql, function (err, result) {
    if (err) throw err;
    res.send(result);
  });
});

app.get("/api/projects/:project", (req, res) => {
  var project = req.params.project;
  project = project.replaceAll("-", " ");
  sql = `SELECT * FROM Projects WHERE Title = "${project}"`;
  readconnection.query(sql, function (err, result) {
    if (err) throw err;
    res.send(result);
  });
});

app.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});

//What the backend will need to acomplish
//Write logs to the database
//Handle authentication and tokens
//Handle Passwords (Must get this right)
//Write new projects to the database
//Read the projects to the frontend
