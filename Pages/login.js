//Send get request to /api/user
fetch("/api/user")
  .then((data) => {
    if (data.status == 200) {
      return data.json();
    }
  })
  .then((data) => {
    if (data != undefined && data.Locked == 0) {
      //## #########
      // The user is successfully logged in and their account is not locked
      //## #########
      if (window.outerWidth < 700) {
        document.getElementById("loginInfo").innerHTML = data.Username;
      } else {
        document.getElementById("loginInfo").innerHTML =
          "Logged in: " + data.Username;
      }
      document.getElementById("loginInfo").href = "/myAccount";
      if (data.Sudo == 1) {
        document.querySelector("nav ul").innerHTML +=
          '<li><a class="listLink" href="/management">Admin</a></li>';
      }
      if (location.href.includes("/projects/")) {
        if (data.WriteComments == 0) {
          document.querySelector(".comment").style.display = "none";
          document.getElementById("commentMessage").innerHTML =
            "Posting comments has been disabled on your account";
        }
      }
    } else if (data != undefined && data.Locked == 1) {
      //## #########
      // If the user is logged in but their account is locked
      //## #########
      alert(
        "Your account has been locked by an admin. You will be logged out. Redirecting to the login page"
      );
      window.location.href = "/login";
    } else {
      //## #########
      // If the user is not logged in at all
      //## #########
      if (window.location.href.includes("/read/")) {
        document.querySelector(".borders h3").style.display = "none";
        document.querySelector(".borders form").style.display = "none";
        document.getElementById(
          "commentMessage"
        ).innerHTML = `<a style="color: inherit;" href="/login">Login</a> To write a comment`;
        //Disable the functions to like on click
        document.querySelectorAll(".CommentLikeBtn").forEach((element) => {
          element.onclick = function () {
            return false;
          };
        });

        document.getElementById("likeBtn").onclick = function () {
          return false;
        };
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
        document.getElementById("ChangepfpHeading").innerHTML =
          "Changing profile pictures has been disabled on your account";
      }
    }
  });
