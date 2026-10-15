<template>
  <div class="home">
    <!-- Hero: a CSS gradient rather than a multi-megabyte photograph. -->
    <section class="hero">
      <div class="hero-inner">
        <p class="hero-eyebrow">Task manager and scheduler</p>
        <h1 class="hero-title">
          Your task list, placed into the hours you actually have
        </h1>
        <p class="hero-subtitle">
          AutoTaskCalendar reads your deadlines, durations and working hours, then builds a
          realistic calendar for you. When something slips, it tells you what that costs
          before you find out the hard way.
        </p>

        <div v-if="!isLoggedIn" class="hero-actions">
          <router-link class="btn btn-primary btn-lg" to="/register">
            Create a free account
          </router-link>
          <router-link class="btn btn-outline-light btn-lg" to="/about">
            See how it works
          </router-link>
        </div>
        <div v-else class="hero-actions">
          <router-link class="btn btn-primary btn-lg" to="/calendar">
            Open my calendar
          </router-link>
          <router-link class="btn btn-outline-light btn-lg" :to="'/user/' + user.username">
            My profile
          </router-link>
        </div>

        <p class="hero-note">Free to use. No credit card required.</p>
      </div>
    </section>

    <BContainer as="section" class="home-section" aria-labelledby="problem-heading">
      <h2 id="problem-heading" class="section-title">
        A to-do list does not tell you when
      </h2>
      <p class="section-lede">
        Lists grow without limit because nothing in them competes for time. A calendar is
        honest about that, but filling one in by hand is tedious and falls apart the first
        time a day runs long. AutoTaskCalendar does the placing for you, and does it again
        whenever things change.
      </p>
    </BContainer>

    <BContainer as="section" class="home-section" aria-labelledby="features-heading">
      <h2 id="features-heading" class="section-title">What it does</h2>
      <div class="feature-grid">
        <article v-for="feature in features" :key="feature.title" class="feature-card">
          <FeatureIcon :name="feature.icon" :size="26" class="feature-card-icon" />
          <h3 class="feature-card-title">{{ feature.title }}</h3>
          <p class="feature-card-text">{{ feature.text }}</p>
        </article>
      </div>
    </BContainer>

    <BContainer as="section" class="home-section" aria-labelledby="steps-heading">
      <h2 id="steps-heading" class="section-title">Getting started</h2>
      <ol class="step-list">
        <li v-for="(step, index) in steps" :key="step.title" class="step">
          <span class="step-number" aria-hidden="true">{{ index + 1 }}</span>
          <div>
            <h3 class="step-title">{{ step.title }}</h3>
            <p class="step-text">{{ step.text }}</p>
          </div>
        </li>
      </ol>
    </BContainer>

    <BContainer as="section" class="home-section">
      <div class="cta-panel">
        <h2 class="cta-title">Start scheduling your week</h2>
        <p class="cta-text">
          Create an account, add a handful of tasks, and let the scheduler lay out your week.
        </p>
        <div class="cta-actions">
          <router-link v-if="!isLoggedIn" class="btn btn-primary btn-lg" to="/register">
            Create a free account
          </router-link>
          <router-link v-else class="btn btn-primary btn-lg" to="/calendar">
            Open my calendar
          </router-link>
        </div>
      </div>
    </BContainer>
  </div>
</template>

<script>
import { BContainer } from 'bootstrap-vue-next';
import FeatureIcon from '@/components/FeatureIcon.vue';
import { useSeo } from '@/composables/useSeo';

export default {
  name: "Home",
  components: {
    BContainer,
    FeatureIcon,
  },
  setup() {
    useSeo({
      title: 'Automatic task scheduling',
      description:
        'AutoTaskCalendar turns your task list into a realistic schedule. It places each '
        + 'task into your working hours automatically, handles recurring work, syncs with '
        + 'Google Calendar, and shows what a missed slot costs. Free to use.',
      path: '/',
    });
  },
  data() {
    return {
      features: [
        {
          icon: 'bolt',
          title: 'Automatic scheduling',
          text: 'Give a task a duration and a due date. The scheduler finds it a slot, respecting priorities and the order work has to happen in.',
        },
        {
          icon: 'clock',
          title: 'Your real working hours',
          text: 'Set the hours and days you actually work, in your own timezone. Nothing is scheduled outside them.',
        },
        {
          icon: 'layers',
          title: 'Long tasks, split up',
          text: 'A task too big for one sitting can be broken into chunks of a size you choose and spread across several days.',
        },
        {
          icon: 'repeat',
          title: 'Recurring work',
          text: 'Daily, weekly, monthly and yearly rules generate real tasks you can complete, reschedule or skip individually.',
        },
        {
          icon: 'shield',
          title: 'See what slipping costs',
          text: 'Ask what happens if a slot is lost. The forecast shows which later tasks move and which would miss their deadline.',
        },
        {
          icon: 'link',
          title: 'Google Calendar sync',
          text: 'Connect your Google Calendar so existing commitments are scheduled around rather than double-booked.',
        },
        {
          icon: 'compass',
          title: 'Roles, goals and projects',
          text: 'Ladder tasks up to the projects and goals they serve, so you can see whether this week went where you meant it to.',
        },
        {
          icon: 'scales',
          title: 'Personal time stays personal',
          text: 'Work tracked under a personal role is reviewed weekly but never given a slot on your work calendar.',
        },
      ],
      steps: [
        {
          title: 'Set your working hours',
          text: 'Tell AutoTaskCalendar which days and hours are yours to work in, and your timezone.',
        },
        {
          title: 'Add your tasks',
          text: 'Each one needs roughly how long it takes and when it is due. Add a repeat rule if it comes back.',
        },
        {
          title: 'Let it schedule',
          text: 'The scheduler places everything into the time you have and flags anything that will not fit.',
        },
        {
          title: 'Review as the week moves',
          text: 'Complete what is done, reschedule when plans change, and check the forecast before giving a slot away.',
        },
      ],
    };
  },
  computed: {
    isLoggedIn() {
      return this.$store.getters.isLoggedIn;
    },
    user() {
      return this.$store.state.user;
    },
  },
};
</script>

<style scoped>
/* Scoped: this page used to leak generic names like .box and .section-header globally. */

.hero {
  position: relative;
  overflow: hidden;
  padding: 96px 20px 104px;
  margin-bottom: 72px;
  text-align: center;
  background:
    radial-gradient(60% 80% at 15% 15%, rgba(102, 126, 234, 0.35) 0%, transparent 60%),
    radial-gradient(55% 75% at 85% 20%, rgba(118, 75, 162, 0.32) 0%, transparent 62%),
    linear-gradient(160deg, #15151d 0%, #1b1a2b 55%, #121219 100%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

/* A faint grid, suggesting a calendar without the weight of an image. */
.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: radial-gradient(70% 60% at 50% 40%, #000 0%, transparent 100%);
  -webkit-mask-image: radial-gradient(70% 60% at 50% 40%, #000 0%, transparent 100%);
  pointer-events: none;
}

.hero-inner {
  position: relative;
  z-index: 1;
  max-width: 820px;
  margin: 0 auto;
}

.hero-eyebrow {
  margin: 0 0 18px;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #9aa6d4;
}

.hero-title {
  margin: 0 0 22px;
  font-size: clamp(2.1rem, 5vw, 3.4rem);
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: #f2f3f7;
}

.hero-subtitle {
  max-width: 660px;
  margin: 0 auto 36px;
  font-size: clamp(1rem, 2vw, 1.18rem);
  line-height: 1.65;
  color: #b4bace;
}

.hero-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
}

.hero-note {
  margin: 22px 0 0;
  font-size: 0.92rem;
  color: #868da3;
}

.home-section {
  margin-bottom: 72px;
  text-align: left;
}

.section-title {
  margin: 0 0 18px;
  font-size: clamp(1.5rem, 3vw, 2.05rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #e8e9ee;
  text-align: center;
}

.section-lede {
  max-width: 720px;
  margin: 0 auto;
  font-size: 1.06rem;
  line-height: 1.7;
  color: #a8aec2;
  text-align: center;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
  margin-top: 36px;
}

.feature-card {
  padding: 26px 24px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  transition: border-color 0.25s ease, transform 0.25s ease, background 0.25s ease;
}

.feature-card:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: rgba(102, 126, 234, 0.45);
  transform: translateY(-3px);
}

.feature-card-icon {
  margin-bottom: 16px;
  color: #8c9bf0;
}

.feature-card-title {
  margin: 0 0 10px;
  font-size: 1.1rem;
  font-weight: 600;
  color: #e8e9ee;
}

.feature-card-text {
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.6;
  color: #a0a6ba;
}

.step-list {
  max-width: 760px;
  margin: 36px auto 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  padding: 22px 24px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
}

.step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-size: 1.05rem;
  font-weight: 700;
  color: #fff;
}

.step-title {
  margin: 0 0 6px;
  font-size: 1.08rem;
  font-weight: 600;
  color: #e8e9ee;
}

.step-text {
  margin: 0;
  font-size: 0.97rem;
  line-height: 1.6;
  color: #a0a6ba;
}

.cta-panel {
  padding: 56px 32px;
  text-align: center;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.16) 0%, rgba(118, 75, 162, 0.16) 100%);
  border: 1px solid rgba(102, 126, 234, 0.28);
  border-radius: 18px;
}

.cta-title {
  margin: 0 0 14px;
  font-size: clamp(1.4rem, 3vw, 1.9rem);
  font-weight: 700;
  color: #eceef4;
}

.cta-text {
  max-width: 540px;
  margin: 0 auto 28px;
  font-size: 1.04rem;
  line-height: 1.6;
  color: #aeb4c8;
}

.cta-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
}

@media (max-width: 576px) {
  .hero {
    padding: 64px 18px 72px;
    margin-bottom: 56px;
  }

  .home-section {
    margin-bottom: 56px;
  }

  .hero-actions .btn,
  .cta-actions .btn {
    width: 100%;
  }

  .step {
    gap: 16px;
    padding: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feature-card {
    transition: none;
  }

  .feature-card:hover {
    transform: none;
  }
}
</style>
