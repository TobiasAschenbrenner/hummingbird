/* Show login form on button click */
$(".loginBtn").click(function () {
    $(".loginForm").show();
    $(".signUpForm").hide();
});
  
/* Show sign up form on button click */
$(".signUpBtn").click(function () {
    $(".loginForm").hide();
    $(".signUpForm").show();
});
  
/* Make login form visible on button click */
$(".login").click(function () {
    $(".form_container").css({ display: "flex" });
    $(".overlay").css({ display: "block" });
});

/* Make login form invisible if clicked outside form */
$(".overlay").click(function () {
    $(".form_container").css({ display: "none" });
    $(".overlay").css({ display: "none" });
});

/* Clear login form */
$(".signUpBtn").click(function () {
    $(".loginForm")[0].reset();
});

/* Clear sign up form */
$(".loginBtn").click(function () {
    $(".signUpForm")[0].reset();
});
