<template>
  <h1>See ya!</h1>
</template>

<script>
export default {
  name: "Logout",
  mounted: function () {
    this.$gtag.pageview(this.$route);
      this.$gtag.event("logout", {
        event_category: "userFunctions",
        event_label: "user",
        value: 1,
      });
    this.$store.dispatch("logout").then(() => {
      this.$router.push("/");
    });
  },
  metaInfo: {
    title: "Logging Out",
    meta: [
      { name: "robots", content: "noindex, nofollow" },
    ],
  },
};
</script>