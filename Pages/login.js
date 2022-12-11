//Send get request to /api/user
fetch("/api/user")
    .then((data) => { if (data.status == 200) { return data.json() } })
    .then((data) => {
        if (data != undefined) {
            document.getElementById("loginInfo").innerHTML = "Logged in: " + data.Username;
            document.getElementById("loginInfo").href = "/myAccount";
            if (data.Sudo == 1) {
                document.querySelector("nav ul").innerHTML += '<li><a class="listLink" href="/management">Management</a></li>';
            }
        } else {
            document.getElementById("likeBtn").disabled = true;
            document.querySelector(".borders h3").style.display = "none";
            document.querySelector(".borders form").style.display = "none";
            document.getElementById("commentMessage").innerHTML = "Login to comment";
        }
    });