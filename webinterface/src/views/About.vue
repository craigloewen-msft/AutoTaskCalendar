<template>
  <div class="pageContent">
    <b-container>
      <div class="row">
        <div class="col-lg-12 text-center">
          <h1>About your site</h1>
          <hr />
        </div>
      </div>
      <div class="row">
        <div class="col-md-7">
          <p>
            Your content goes here
            </p>
        </div>
        <div class="col-md-5">
          <img
            src="https://storage.googleapis.com/kaggle-datasets-images/10116/14254/15677e366344f4680954aa6dad902386/dataset-card.jpg?t=2018-01-18-17-36-19"
            class="img-responsive"
          />
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