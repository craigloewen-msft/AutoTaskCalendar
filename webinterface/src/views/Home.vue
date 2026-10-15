<template>
  <div class="home">
    <section class="home-hero">
      <span class="home-eyebrow">Free task manager &middot; auto-scheduling</span>
      <h1 class="home-title">Your tasks, scheduled<br />into your calendar.</h1>
      <p class="home-lede">
        Add what you need to do and when it's due. AutoTaskCalendar fits it around your
        meetings and working hours, so your week plans itself.
      </p>
      <div v-if="!this.$store.getters.isLoggedIn" class="loginSelect">
        <router-link class="btn btn-primary btn-lg" to="/register">Get started free</router-link>
        <router-link class="btn btn-outline-secondary btn-lg" to="/login">Login</router-link>
      </div>
      <div v-if="this.$store.getters.isLoggedIn" class="loginSelect">
        <router-link class="btn btn-primary btn-lg" to="/calendar">Open calendar</router-link>
        <router-link class="btn btn-outline-secondary btn-lg" :to="'/user/' + user.username"
          >My Profile
        </router-link>
      </div>
    </section>

    <BContainer class="section-slides">
      <div class="home-features">
        <div class="home-feature">
          <h3>Auto-scheduling</h3>
          <p>Tasks are placed into free time before their due dates, and move when plans change.</p>
        </div>
        <div class="home-feature">
          <h3>Weekly planning</h3>
          <p>Commit to projects each week and review how last week actually went.</p>
        </div>
        <div class="home-feature">
          <h3>Google Calendar sync</h3>
          <p>Meetings come in from your calendar so scheduled work never collides with them.</p>
        </div>
      </div>
    </BContainer>
  </div>
</template>

<script>
// @ is an alias to /src
// import HelloWorld from '@/components/HelloWorld.vue'
import { BContainer } from 'bootstrap-vue-next';

export default {
  name: "Home",
  components: {
    BContainer
  },
  computed: {
    user: function () {
      return this.$store.state.user;
    },
  },
  metaInfo: {
    title: "Home - Automatic Task Scheduling Made Easy",
    meta: [
      {
        name: "description",
        content: "AutoTaskCalendar automatically schedules your tasks into your calendar. Free to use, intelligent planning, and seamless Google Calendar integration. Start managing your tasks smarter today.",
      },
      { 
        name: "keywords", 
        content: "free task manager, automatic task scheduling, calendar management, productivity tool, task organizer, time management, Google Calendar sync" 
      },
      { property: "og:title", content: "AutoTaskCalendar - Automatic Task Scheduling Made Easy" },
      { 
        property: "og:description", 
        content: "Free task management with automatic scheduling. Integrate with Google Calendar and let AutoTaskCalendar organize your work intelligently." 
      },
      { name: "twitter:title", content: "AutoTaskCalendar - Automatic Task Scheduling Made Easy" },
      { 
        name: "twitter:description", 
        content: "Free task management with automatic scheduling. Integrate with Google Calendar and let AutoTaskCalendar organize your work intelligently." 
      },
    ],
  },
};
</script>

<style>
.home-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14vh 20px 10vh;
  overflow: hidden;
}

/* A soft accent glow behind the headline instead of a photo. */
.home-hero::before {
  content: "";
  position: absolute;
  inset: -40% 10% auto;
  height: 520px;
  background: radial-gradient(closest-side, rgba(99, 102, 241, 0.22), transparent);
  pointer-events: none;
}

.home-hero > * {
  position: relative;
}

.home-eyebrow {
  display: inline-block;
  padding: 4px 12px;
  margin-bottom: 20px;
  border: 1px solid var(--atc-border-strong);
  border-radius: var(--atc-radius-pill);
  background: var(--atc-surface);
  color: var(--atc-text-muted);
  font-size: 13px;
}

.home-title {
  font-size: clamp(2.2rem, 5vw, 3.6rem);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -0.035em;
  margin: 0 0 18px;
}

.home-lede {
  max-width: 560px;
  margin: 0 auto;
  color: var(--atc-text-muted);
  font-size: 1.1rem;
  line-height: 1.6;
}

.loginSelect {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.loginSelect .btn-lg {
  font-size: 1rem;
  padding: 0.65rem 1.3rem;
}

.section-slides {
  margin-bottom: 64px;
}

.home-features {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  text-align: left;
}

.home-feature {
  padding: 22px;
  background: var(--atc-surface);
  border: 1px solid var(--atc-border);
  border-radius: var(--atc-radius-lg);
}

.home-feature h3 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 6px;
}

.home-feature p {
  margin: 0;
  color: var(--atc-text-muted);
  font-size: 14px;
  line-height: 1.55;
}
</style>
