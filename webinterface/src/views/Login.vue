<template>
  <div class="pageContent auth-page">
    <div class="auth-card">
      <h1 class="auth-title">Welcome back</h1>
      <p class="auth-subtitle">Sign in to see your scheduled week.</p>
      <p v-if="failuretext" class="auth-error" role="alert">{{ failuretext }}</p>
      <label class="form-label" for="login-username">Username</label>
      <input
        id="login-username"
        class="form-control"
        type="text"
        name="username"
        autocomplete="username"
        v-model="input.username"
        placeholder="Username"
      />
      <label class="form-label" for="login-password">Password</label>
      <input
        id="login-password"
        class="form-control"
        type="password"
        name="password"
        autocomplete="current-password"
        v-model="input.password"
        placeholder="Password"
        @keyup.enter="login"
      />
      <button class="btn btn-primary btn-block auth-submit" v-on:click="login">
        Sign in
      </button>
      <p class="auth-switch">
        New here? <router-link to="/register">Create an account</router-link>
      </p>
    </div>
  </div>
</template>

<script>
let devEndPoint = "/api/";

export default {
  name: "Login",
  data() {
    return {
      failuretext: null,
      input: {
        username: "",
        password: "",
      },
    };
  },
  methods: {
    // Return to the page that bounced us to login, ignoring anything off-site.
    redirectTarget: function (username) {
      const next = this.$route.query.next;
      if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
        return next;
      }
      return "/user/" + username;
    },
    login: function () {
      this.userdata = "Loading!";
      this.$http
        .post(devEndPoint + "login/", {
          username: this.input.username,
          password: this.input.password,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        .then((response) => {
          if (response.data.success) {
            // Success login
            this.$store
              .dispatch("login", {
                user: response.data.user,
              })
              .then(() => {
                if (this.$gtag) {
                  this.$gtag.event("login", {
                    event_category: "userFunctions",
                    event_label: response.data.user.username,
                    value: 1
                  });
                }
                this.$router.push(this.redirectTarget(response.data.user.username));
              });
          } else {
            // Failure login
            console.log("Failure to login", response);
            this.failuretext = response.data.log;
          }
        })
        .catch((errors) => {
          console.log("Cannot login");
          console.log(errors);
        });
      //   axios.get(devEndPoint).then(response => (this.userdata = response.data));
    },
  },
  metaInfo: {
    title: "Login - Access Your Task Calendar",
    meta: [
      {
        name: "description",
        content: "Sign in to AutoTaskCalendar to access your tasks, view your automatically scheduled calendar, and manage your productivity.",
      },
      { 
        name: "keywords", 
        content: "login, sign in, task calendar, access account, task manager login" 
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Login to AutoTaskCalendar" },
      { 
        property: "og:description", 
        content: "Sign in to access your automatically scheduled task calendar." 
      },
    ],
  },
};
</script>

<style>
</style>