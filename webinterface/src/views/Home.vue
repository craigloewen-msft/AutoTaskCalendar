<template>
  <div>
    <div class="jumbotron header-container">
      <div class="header-text-container">
        <h2>AutoTaskCalendar</h2>
        <h4>Automatically schedule tasks into your calendar</h4>
        <div v-if="!this.$store.getters.isLoggedIn" class="loginSelect">
          <router-link class="btn btn-primary" to="/login">Login</router-link>
          <router-link class="btn btn-primary" to="/register"
            >Register</router-link
          >
        </div>
        <div v-if="this.$store.getters.isLoggedIn" class="loginSelect">
          <router-link class="btn btn-primary" :to="'/user/' + user.username"
            >My Profile
          </router-link>
        </div>
      </div>
    </div>

    <b-container class="section-slides">
      <header class="section-header">
        <p>Make it easy to manage what you need to do</p>
      </header>

      <div class="row">
        <div class="col">It's free to register and use!</div>
      </div>
    </b-container>
  </div>
</template>

<script>
// @ is an alias to /src
// import HelloWorld from '@/components/HelloWorld.vue'

export default {
  name: "Home",
  components: {
  },
  computed: {
    user: function () {
      return this.$store.state.user;
    },
  },
  mounted: function () {
    this.$gtag.pageview(this.$route);
  },
};
</script>

<style>
.loginSelect {
  display: flex;
  justify-content: center;
  margin-top: 30px;
}

.loginSelect a {
  margin-left: 15px;
  margin-right: 15px;
}

.header-container {
  background: url(../../public/bg.jpg);
  background-position-x: center;
  background-position-y: center;
  background-attachment: fixed;
  background-repeat: no-repeat;
  background-size: cover;
  box-shadow: inset 0 0 0 2000px rgba(0, 0, 0, 0.925);
  height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-x: hidden;
  overflow-y: hidden;
  margin-bottom: 50px;
}

.header-text-container {
  color: #eee;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  justify-items: center;
}

.section-header {
  margin-bottom: 10px;
}

.section-header h2 {
  font-size: 13px;
  letter-spacing: 1px;
  font-weight: 700;
  margin: 0;
  text-transform: uppercase;
}

.section-header p {
  margin: 10px 0 0 0;
  padding: 0;
  font-size: 38px;
  line-height: 42px;
  font-weight: 700;
}

.box {
  border: 1px solid #e2eefd;
  padding: 30px 20px;
  transition: all ease-in-out 0.3s;
  height: 100%;
}

.box h3 {
  transition: all ease-in-out 0.3s;
}

.box:hover {
  border-color: #fff;
  box-shadow: 0px 0 25px 0 rgb(16 110 234 / 10%);
}

.box:hover h3 {
  color: #adadad;
}

.card-img {
  padding: 15px 30px;
}

.section-slides {
  margin-bottom: 30px;
}

.cover-gif {
  max-height: 60%;
}
</style>