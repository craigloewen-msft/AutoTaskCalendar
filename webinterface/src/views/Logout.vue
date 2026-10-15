<template>
  <h1>See ya!</h1>
</template>

<script>
import { useSeo } from '@/composables/useSeo';

export default {
  name: "Logout",
  setup() {
    useSeo({ title: 'Signing out', noindex: true });
  },
  mounted: function () {
    if (this.$gtag) {
      this.$gtag.event("logout", {
        event_category: "userFunctions",
        event_label: "user",
        value: 1,
      });
    }
    this.$store.dispatch("logout").then(() => {
      this.$router.push("/");
    });
  },
};
</script>