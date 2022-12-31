//Send get request to /api/user
fetch("/api/user")
  .then((data) => {
    if (data.status == 200) {
      return data.json();
    }
  })
  .then((data) => {
    if (data != undefined) {
      document.getElementById("loginInfo").innerHTML =
        "Logged in: " + data.Username;
      document.getElementById("loginInfo").href = "/myAccount";
      if (data.Sudo == 1) {
        document.querySelector("nav ul").innerHTML +=
          '<li><a class="listLink" href="/management">Management</a></li>';
      }
      if (location.href.includes('/projects/')) {
        if (data.WriteComments == 0) {
          document.querySelector(".comment").style.display = "none";
          document.getElementById('commentMessage').innerHTML = "Posting comments has been disabled on your account"
        }
      }
    } else {
      if (window.location.href.includes("/projects/")) {
        document.getElementById("likeBtn").disabled = true;
        document.querySelector(".borders h3").style.display = "none";
        document.querySelector(".borders form").style.display = "none";
        document.getElementById(
          "commentMessage"
        ).innerHTML = `<a class="listLink" href="/login">Login</a> to comment`;
        document.querySelectorAll("#comments button").forEach((btn) => {
          btn.disabled = true;
        });
      }
    }

    //If the href is the /myAccount page then change the title of the page to be Welcome username
    if (
      window.location.href.includes("/myAccount") ||
      window.location.href.includes("/management")
    ) {
      document.querySelector("head title").innerHTML =
        "Welcome,  " + data.Username;
    }
    if (window.location.href.includes("/myAccount")) {
      document.querySelector("header h1").innerHTML =
        "Welcome,  " + data.Username;
      if (data.ModifyProfilePicture == 0) {
        //Get the children of the .Changepfp form
        document.getElementById("Changepfp").style.display = "none";
        document.getElementById('ChangepfpHeading').innerHTML = "Changing profile pictures has been disabled on your account"
      }
    }
  });
