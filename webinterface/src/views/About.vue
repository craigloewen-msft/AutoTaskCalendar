<template>
  <div class="pageContent">
    <b-container>
      <div class="row">
        <div class="col-lg-12 text-center">
          <h1>About</h1>
          <hr />
        </div>
      </div>
      <div class="row">
        <div class="col-md-4">
          <p>
            This site allows you to auto schedule your tasks into your calendar.
          </p>
        </div>
        <div class="col-md-4 text-center">
          <img src="ubuntu.png" class="img-responsive" />
        </div>
        <div class="col-md-4 text-right">
          <p>안녕하세요</p>
        </div>
      </div>
    </b-container>
  </div>
</template>

<script>

export default {
  name: "About",
  mounted: function () {
    this.$gtag.pageview(this.$route);
  },
};
</script>


<style>
</style>