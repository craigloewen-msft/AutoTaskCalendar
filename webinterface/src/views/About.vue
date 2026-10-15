<template>
  <div class="pageContent about">
    <BContainer>
      <header class="about-hero">
        <p class="about-eyebrow">About</p>
        <h1 class="about-title">Scheduling that respects the time you actually have</h1>
        <p class="about-lede">
          AutoTaskCalendar is a task manager that writes your calendar for you. You describe
          the work; it decides when each piece happens, keeps that plan current as the week
          moves, and is honest when more is planned than will fit.
        </p>
      </header>

      <BRow>
        <BCol lg="10" xl="9" class="mx-auto">
          <section class="about-section" aria-labelledby="why-heading">
            <h2 id="why-heading" class="about-section-title">Why it exists</h2>
            <p class="about-text">
              A to-do list has no notion of time, so it never pushes back: you can add a
              hundred items to a week that holds twenty. A calendar does push back, but
              maintaining one by hand is tedious, and the first overrun invalidates the rest
              of the day.
            </p>
            <p class="about-text">
              AutoTaskCalendar sits between the two. It keeps the low effort of a list while
              giving you the realism of a calendar, because every task carries how long it
              takes and when it is due, and the scheduler places it in the hours you have
              said are yours.
            </p>
          </section>

          <section class="about-section" aria-labelledby="capabilities-heading">
            <h2 id="capabilities-heading" class="about-section-title">What it does</h2>
            <div class="capability-grid">
              <article
                v-for="capability in capabilities"
                :key="capability.title"
                class="capability"
              >
                <FeatureIcon :name="capability.icon" :size="24" class="capability-icon" />
                <div>
                  <h3 class="capability-title">{{ capability.title }}</h3>
                  <p class="capability-text">{{ capability.text }}</p>
                </div>
              </article>
            </div>
          </section>

          <section class="about-section" aria-labelledby="how-heading">
            <h2 id="how-heading" class="about-section-title">How scheduling works</h2>
            <ol class="about-steps">
              <li v-for="(step, index) in steps" :key="step.title" class="about-step">
                <span class="about-step-number" aria-hidden="true">{{ index + 1 }}</span>
                <div>
                  <h3 class="about-step-title">{{ step.title }}</h3>
                  <p class="about-step-text">{{ step.text }}</p>
                </div>
              </li>
            </ol>
            <p class="about-footnote">
              Scheduling runs on demand, never silently in the background, so the plan only
              changes when you ask it to.
            </p>
          </section>

          <section class="about-section" aria-labelledby="principles-heading">
            <h2 id="principles-heading" class="about-section-title">How it behaves</h2>
            <ul class="principle-list">
              <li v-for="principle in principles" :key="principle" class="principle">
                <FeatureIcon name="check" :size="18" class="principle-icon" />
                <span>{{ principle }}</span>
              </li>
            </ul>
          </section>

          <section class="about-section" aria-labelledby="open-heading">
            <h2 id="open-heading" class="about-section-title">Open source</h2>
            <p class="about-text">
              AutoTaskCalendar is open source and free to use. You can read exactly how the
              scheduler makes its decisions, file an issue, or run your own copy.
              <a
                href="https://github.com/craigloewen-msft/AutoTaskCalendar"
                target="_blank"
                rel="noopener"
              >View the source on GitHub</a>.
            </p>
          </section>

          <div class="about-cta">
            <h2 class="about-cta-title">Try it on next week</h2>
            <p class="about-cta-text">
              Add the work you already know about and see what a realistic version of your
              week looks like.
            </p>
            <div class="about-cta-actions">
              <BButton variant="primary" size="lg" to="/register">
                Create a free account
              </BButton>
              <BButton variant="outline-primary" size="lg" to="/login">
                Sign in
              </BButton>
            </div>
          </div>
        </BCol>
      </BRow>
    </BContainer>
  </div>
</template>

<script>
import { BContainer, BRow, BCol, BButton } from 'bootstrap-vue-next';
import FeatureIcon from '@/components/FeatureIcon.vue';
import { useSeo } from '@/composables/useSeo';

export default {
  name: "About",
  components: {
    BContainer,
    BRow,
    BCol,
    BButton,
    FeatureIcon,
  },
  setup() {
    useSeo({
      title: 'About',
      description:
        'How AutoTaskCalendar works: it places each task into your working hours '
        + 'automatically, splits long tasks into chunks, handles recurring work, syncs with '
        + 'Google Calendar, and forecasts what a missed slot costs. Open source and free.',
      path: '/about',
    });
  },
  data() {
    return {
      capabilities: [
        {
          icon: 'bolt',
          title: 'Automatic scheduling',
          text: 'Every task has a duration and a due date. The scheduler places them into your free working hours, honouring priority and any task that must wait for another to finish.',
        },
        {
          icon: 'clock',
          title: 'Working hours and timezone',
          text: 'You set the days you work and the hours within them, in your own timezone. The scheduler never places work outside those hours, and daylight-saving changes are handled properly.',
        },
        {
          icon: 'layers',
          title: 'Chunking long tasks',
          text: 'Mark a long task as breakable and choose a chunk size. It is spread across as many days as it needs instead of demanding one impossible block.',
        },
        {
          icon: 'repeat',
          title: 'Recurring tasks',
          text: 'Daily, weekly, monthly and yearly rules generate real occurrences over a rolling window. Completing, editing or deleting one occurrence leaves the rest of the series intact.',
        },
        {
          icon: 'shield',
          title: 'Slip forecasting',
          text: 'Before giving up a slot, ask what it would cost. The forecast lists which later tasks move and which would newly miss a deadline, and several lost slots can be analysed together.',
        },
        {
          icon: 'link',
          title: 'Google Calendar',
          text: 'Connect your Google account and existing events are treated as time that is already spoken for, so scheduled work fits around your meetings.',
        },
        {
          icon: 'compass',
          title: 'Roles, goals and projects',
          text: 'An optional layer above tasks. Attach a task to a project, and it ladders up to a goal and a role, so you can see whether your week went where you intended.',
        },
        {
          icon: 'calendar',
          title: 'Weekly planning and review',
          text: 'Start the week by committing to the work you mean to do, then review progress against that commitment as the week unfolds.',
        },
      ],
      steps: [
        {
          title: 'You describe the work',
          text: 'A task is a title, roughly how long it takes, and when it is due. Everything else is optional.',
        },
        {
          title: 'It finds the free time',
          text: 'Your working days and hours, minus anything already on your calendar, give the slots available to fill.',
        },
        {
          title: 'It places the tasks',
          text: 'Tasks are fitted into those slots by deadline and priority, splitting breakable ones and keeping dependent work in order.',
        },
        {
          title: 'It tells you what will not fit',
          text: 'Work it cannot find a slot for is flagged as needing time rather than quietly dropped, so you can shorten it, move it, or let it go yourself.',
        },
      ],
      principles: [
        'Nothing is scheduled outside the working hours you set.',
        'Rescheduling happens when you ask for it, not silently behind your back.',
        'Work it cannot place is flagged as needing time, never hidden.',
        'Completed history is preserved when a recurring series changes.',
        'Compass, projects and weekly planning are entirely optional.',
        'Personal work is tracked weekly but never placed on your work calendar.',
      ],
    };
  },
};
</script>

<style scoped>
.about-hero {
  max-width: 760px;
  margin: 0 auto 56px;
  padding: 56px 24px;
  text-align: center;
  background:
    radial-gradient(70% 90% at 20% 10%, rgba(102, 126, 234, 0.22) 0%, transparent 62%),
    radial-gradient(60% 80% at 85% 15%, rgba(118, 75, 162, 0.2) 0%, transparent 64%),
    linear-gradient(160deg, rgba(102, 126, 234, 0.08) 0%, rgba(118, 75, 162, 0.08) 100%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 18px;
}

.about-eyebrow {
  margin: 0 0 14px;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #9aa6d4;
}

.about-title {
  margin: 0 0 18px;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -0.02em;
  color: #f1f2f7;
}

.about-lede {
  max-width: 600px;
  margin: 0 auto;
  font-size: 1.06rem;
  line-height: 1.65;
  color: #aeb4c8;
}

.about-section {
  margin-bottom: 56px;
  text-align: left;
}

.about-section-title {
  margin: 0 0 18px;
  font-size: clamp(1.3rem, 2.6vw, 1.7rem);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #e8e9ee;
}

.about-text {
  margin: 0 0 14px;
  font-size: 1.02rem;
  line-height: 1.72;
  color: #a8aec2;
}

.about-text a {
  color: #8c9bf0;
}

.capability-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
}

.capability {
  display: flex;
  gap: 16px;
  padding: 22px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  transition: border-color 0.25s ease, background 0.25s ease;
}

.capability:hover {
  background: rgba(255, 255, 255, 0.045);
  border-color: rgba(102, 126, 234, 0.4);
}

.capability-icon {
  margin-top: 2px;
  color: #8c9bf0;
}

.capability-title {
  margin: 0 0 8px;
  font-size: 1.05rem;
  font-weight: 600;
  color: #e8e9ee;
}

.capability-text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #a0a6ba;
}

.about-steps {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.about-step {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding: 20px 22px;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
}

.about-step-number {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
}

.about-step-title {
  margin: 0 0 6px;
  font-size: 1.04rem;
  font-weight: 600;
  color: #e8e9ee;
}

.about-step-text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: #a0a6ba;
}

.about-footnote {
  margin: 18px 0 0;
  font-size: 0.93rem;
  color: #868da3;
}

.principle-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px 24px;
}

.principle {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 0.98rem;
  line-height: 1.55;
  color: #a8aec2;
}

.principle-icon {
  margin-top: 3px;
  color: #6fcf97;
}

.about-cta {
  padding: 52px 32px;
  text-align: center;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.16) 0%, rgba(118, 75, 162, 0.16) 100%);
  border: 1px solid rgba(102, 126, 234, 0.28);
  border-radius: 18px;
}

.about-cta-title {
  margin: 0 0 12px;
  font-size: clamp(1.35rem, 3vw, 1.8rem);
  font-weight: 700;
  color: #eceef4;
}

.about-cta-text {
  max-width: 520px;
  margin: 0 auto 26px;
  font-size: 1.02rem;
  line-height: 1.6;
  color: #aeb4c8;
}

.about-cta-actions {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 14px;
}

@media (max-width: 576px) {
  .about-hero {
    padding: 40px 20px;
    margin-bottom: 40px;
  }

  .about-section {
    margin-bottom: 44px;
  }

  .about-cta-actions .btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .capability {
    transition: none;
  }
}
</style>
