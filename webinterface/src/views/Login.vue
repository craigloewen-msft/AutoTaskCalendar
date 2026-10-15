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
import { useSeo } from '@/composables/useSeo';

let devEndPoint = "/api/";

export default {
  name: "Login",
  setup() {
    useSeo({ title: 'Sign in', noindex: true });
  },
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
};
</script>

<style>
</style>