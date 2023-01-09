<template>
  <div>
    <h1>User info</h1>
    <p>{{ user }}</p>
  </div>
</template>

<script>
import router from "../router";

export default {
  name: "User",
  components: {
  },
  data() {
    return {
      user: this.$store.state.user,
    };
  },
  methods: {
  },
  mounted() {
    this.$gtag.pageview(this.$route);
  },
};
</script>

<style>
</style>