<template>
  <div class="pageContent auth-page">
    <div class="auth-card">
      <header class="auth-header">
        <h1 class="auth-title">Create an account</h1>
        <p class="auth-subtitle">Free to register and use.</p>
      </header>

      <p v-if="failuretext" class="auth-error" role="alert">{{ failuretext }}</p>

      <div class="auth-field">
        <label class="form-label" for="register-email">Email</label>
        <input
          id="register-email"
          class="form-control"
          type="text"
          name="email"
          autocomplete="email"
          v-model="input.email"
          placeholder="you@example.com"
        />
        <p class="auth-hint">Used to send you notifications.</p>
      </div>

      <div class="auth-field">
        <label class="form-label" for="register-username">Username</label>
        <input
          id="register-username"
          class="form-control"
          type="text"
          name="username"
          autocomplete="username"
          v-model="input.username"
          placeholder="Pick a username"
        />
      </div>

      <div class="auth-field">
        <label class="form-label" for="register-password">Password</label>
        <input
          id="register-password"
          class="form-control"
          type="password"
          name="password"
          autocomplete="new-password"
          v-model="input.password"
          placeholder="Choose a password"
          @keyup.enter="register"
        />
      </div>

      <div class="auth-field">
        <label class="form-label" for="register-password-confirm">Confirm password</label>
        <input
          id="register-password-confirm"
          class="form-control"
          type="password"
          name="passwordconfirm"
          autocomplete="new-password"
          v-model="input.passwordconfirm"
          placeholder="Repeat your password"
          @keyup.enter="register"
        />
      </div>

      <button class="btn btn-primary btn-lg btn-block auth-submit" v-on:click="register">
        Register
      </button>

      <p class="auth-alt">
        Already have an account? <router-link to="/login">Sign in</router-link>
      </p>
    </div>
  </div>
</template>

<script>
import axios from "axios";
import { useSeo } from '@/composables/useSeo';

let devEndPoint = "/api/";

export default {
  name: "Register",
  setup() {
    useSeo({ title: 'Create an account', noindex: true });
  },
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

.auth-hint {
  margin: var(--space-1) 0 0;
  color: var(--text-faint);
  font-size: var(--fs-sm);
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
