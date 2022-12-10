//Send get request to /api/user
fetch("/api/user")
    .then((data) => data.json())
    .then((data) => {
        //if response code = 200 then change the innerhtml of the element with the id of loginInfo to the response text and remove the class and the href
        document.getElementById("loginInfo").innerHTML = "Logged in: " + data.Username;
        document.getElementById("loginInfo").removeAttribute("href");
    });