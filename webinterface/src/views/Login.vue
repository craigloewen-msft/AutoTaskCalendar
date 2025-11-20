<template>
  <div class="pageContent">
    <BContainer class="user-form-box">
      <h1>Please sign in</h1>
      <p v-if="failuretext">{{ failuretext }}</p>
      <input
        class="form-control"
        type="text"
        name="username"
        v-model="input.username"
        placeholder="Username"
      />
      <input
        class="form-control"
        type="password"
        name="password"
        v-model="input.password"
        placeholder="Password"
        @keyup.enter="login"
      />
      <br />
      <button class="btn btn-lg btn-primary btn-block" v-on:click="login">
        Sign in
      </button>
    </BContainer>
  </div>
</template>

<script>
import { BContainer } from 'bootstrap-vue-next';

let APIEndpoint = "https://api.coindesk.com/v1/bpi/currentprice.json";
let devEndPoint = "/api/";

export default {
  name: "Login",
  components: {
    BContainer
  },
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
    login: function () {
      this.userdata = "Loading!";
      this.$http
        .post(devEndPoint + "login/", {
          username: this.input.username,
          password: this.input.password,
        })
        .then((response) => {
          if (response.data.success) {
            // Success login
            this.$store
              .dispatch("login", {
                token: response.data.token,
                user: response.data.user,
              })
              .then(() => {
                this.$gtag.event("login", {
                  event_category: "userFunctions",
                  event_label: response.data.user.username,
                  value: 1
                });
                this.$router.push("/user/" + response.data.user.username);
              });
          } else {
            // Failure login
            console.log("Failure to login", response);
            this.failuretext = response.data.log;
          }
          // Add in JWT
        })
        .catch((errors) => {
          console.log("Cannot login");
          console.log(errors);
        });
      //   axios.get(devEndPoint).then(response => (this.userdata = response.data));
    },
  },
<<<<<<< HEAD
  mounted: function () {
    this.$gtag.pageview(this.$route);
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
=======
>>>>>>> 01210f6 (Configure Google Analytics with environment variable support)
};
</script>

<style>
</style>