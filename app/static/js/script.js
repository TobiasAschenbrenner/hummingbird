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

/* Filter posts */
$(document).ready(function () {
    $(".filter-item").click(function () {
        const value = $(this).attr("data-filter");
        if (value == "all") {
            $(".post-box").show();
        } else {
            $(".post-box").not("." + value).hide();
            $(".post-box").filter("." + value).show();
        }
    })
    // Add active to btn
    $(".filter-item").click(function () {
        $(this).addClass("active-filter")
        $(this).siblings().removeClass("active-filter");
    })
})
