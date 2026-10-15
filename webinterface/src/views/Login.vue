<template>
  <div class="pageContent auth-page">
    <div class="auth-card">
      <header class="auth-header">
        <h1 class="auth-title">Welcome back</h1>
        <p class="auth-subtitle">Sign in to your calendar.</p>
      </header>

      <p v-if="failuretext" class="auth-error" role="alert">{{ failuretext }}</p>

      <div class="auth-field">
        <label class="form-label" for="login-username">Username</label>
        <input
          id="login-username"
          class="form-control"
          type="text"
          name="username"
          autocomplete="username"
          v-model="input.username"
          placeholder="Your username"
        />
      </div>

      <div class="auth-field">
        <label class="form-label" for="login-password">Password</label>
        <input
          id="login-password"
          class="form-control"
          type="password"
          name="password"
          autocomplete="current-password"
          v-model="input.password"
          placeholder="Your password"
          @keyup.enter="login"
        />
      </div>

      <button class="btn btn-lg btn-primary btn-block auth-submit" v-on:click="login">
        Sign in
      </button>

      <p class="auth-alt">
        No account yet? <router-link to="/register">Register</router-link>
      </p>
    </div>
  </div>
</template>

<script>
import { useSeo } from '@/composables/useSeo';

let devEndPoint = "/api/";

export default {
  name: "Login",
  setup() {
    useSeo({ title: 'Sign in', noindex: true });
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

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  padding: var(--space-8) var(--space-4);
}

.auth-card {
  width: 100%;
  max-width: 420px;
  padding: var(--space-6);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-1);
  box-shadow: var(--elev-3);
  text-align: left;
}

.auth-header {
  margin-bottom: var(--space-5);
  text-align: center;
}

.auth-title {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-2xl);
}

.auth-subtitle {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--fs-md);
}

.auth-error {
  margin-bottom: var(--space-4);
  padding: var(--space-3);
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger-text);
  font-size: var(--fs-md);
}

.auth-field {
  margin-bottom: var(--space-4);
}

.auth-submit {
  margin-top: var(--space-2);
}

.auth-alt {
  margin: var(--space-5) 0 0;
  color: var(--text-muted);
  font-size: var(--fs-md);
  text-align: center;
}
</style>
