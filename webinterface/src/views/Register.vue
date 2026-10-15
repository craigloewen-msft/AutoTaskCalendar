<template>
  <div class="pageContent auth-page">
    <div class="auth-card">
      <h1 class="auth-title">Create your account</h1>
      <p class="auth-subtitle">Free, and your tasks schedule themselves.</p>
      <p v-if="failuretext" class="auth-error" role="alert">{{ failuretext }}</p>
      <label class="form-label" for="register-email">Email</label>
      <input
        id="register-email"
        class="form-control"
        type="text"
        name="email"
        autocomplete="email"
        v-model="input.email"
        placeholder="For notifications"
      />
      <label class="form-label" for="register-username">Username</label>
      <input
        id="register-username"
        class="form-control"
        type="text"
        name="username"
        autocomplete="username"
        v-model="input.username"
        placeholder="Username"
      />
      <label class="form-label" for="register-password">Password</label>
      <input
        id="register-password"
        class="form-control"
        type="password"
        name="password"
        autocomplete="new-password"
        v-model="input.password"
        placeholder="Password"
        @keyup.enter="register"
      />
      <label class="form-label" for="register-passwordconfirm">Confirm password</label>
      <input
        id="register-passwordconfirm"
        class="form-control"
        type="password"
        name="passwordconfirm"
        autocomplete="new-password"
        v-model="input.passwordconfirm"
        placeholder="Confirm password"
        @keyup.enter="register"
      />
      <button class="btn btn-primary btn-block auth-submit" v-on:click="register">
        Register
      </button>
      <p class="auth-switch">
        Already have an account? <router-link to="/login">Sign in</router-link>
      </p>
    </div>
  </div>
</template>

<script>
import axios from "axios";

let devEndPoint = "/api/";

export default {
  name: "Register",
  data() {
    return {
      failuretext: null,
      input: {
        username: "",
        password: "",
        email: "",
        passwordconfirm: "",
      },
    };
  },
  methods: {
    register: function () {
      if (!this.checkInfo()) {
        return;
      }

      axios
        .post(devEndPoint + "register/", {
          username: this.input.username,
          password: this.input.password,
          email: this.input.email,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          githubUsername: this.input.githubUsername,
        })
        .then((response) => {
          if (response.data.success) {
            // // Success login
            this.$store
              .dispatch("register", {
                user: response.data.user,
              })
              .then(() => {
                if (this.$gtag) {
                  this.$gtag.event("register", {
                    event_category: "userFunctions",
                    event_label: response.data.user.username,
                    value: 50
                  });
                }
                this.$router.push("/user/" + response.data.user.username);
              });
          } else {
            // Failure Register
            console.log("Failure to register", response);
            this.failuretext = response.data.log;
          }
        })
        .catch((errors) => {
          console.log("Cannot register");
          console.log(errors);
        });
    },
    validateEmail: function (mail) {
      if (
        /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(
          mail
        )
      ) {
        return true;
      }
      return false;
    },
    checkInfo: function () {
      if (this.input.username.length < 4) {
        this.failuretext = "Username must be more than 4 characters";
        return false;
      }
      if (this.input.password.length < 4) {
        this.failuretext = "Password must be 4 or more characters";
        return false;
      }
      if (!this.validateEmail(this.input.email)) {
        this.failuretext = "Email is invalid";
        return false;
      }
      if (this.input.username.length > 20) {
        this.failuretext = "Username is too long";
        return false;
      }
      if (this.input.password.length > 30) {
        this.failuretext = "Password is too long";
        return false;
      }
      if (this.input.email.length > 30) {
        this.failuretext = "Email is too long";
        return false;
      }
      if (!(this.input.password == this.input.passwordconfirm)) {
        this.failuretext = "Passwords don't match";
        return false;
      }
      return true;
    },
  },
  metaInfo: {
    title: "Register - Start Scheduling Tasks Automatically",
    meta: [
      {
        name: "description",
        content: "Create your free AutoTaskCalendar account to start automatically scheduling tasks, integrating with Google Calendar, and managing your productivity effortlessly.",
      },
      { 
        name: "keywords", 
        content: "register, sign up, create account, free task manager, task calendar registration, productivity account" 
      },
      { property: "og:title", content: "Register for AutoTaskCalendar - Free Task Scheduling" },
      { 
        property: "og:description", 
        content: "Create your free account and start scheduling tasks automatically with intelligent planning." 
      },
      { name: "twitter:title", content: "Register for AutoTaskCalendar - Free Task Scheduling" },
      { 
        name: "twitter:description", 
        content: "Create your free account and start scheduling tasks automatically with intelligent planning." 
      },
    ],
  },
};
</script>