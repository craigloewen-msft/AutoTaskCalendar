<template>
  <div class="pageContent">
    <BContainer>
      <!-- Hero Section -->
      <div class="about-hero">
        <div class="hero-icon">📅</div>
        <h1 class="hero-title">About AutoTaskCalendar</h1>
        <p class="hero-subtitle">Your intelligent task scheduling companion</p>
      </div>

      <!-- Main Content -->
      <BRow class="content-section">
        <BCol lg="10" xl="8" class="mx-auto">
          <!-- What is it Section -->
          <BCard class="feature-card mb-4">
            <div class="card-icon">✨</div>
            <h2 class="card-title">Smart Task Management</h2>
            <p class="card-text">
              AutoTaskCalendar is an intelligent task management system that automatically 
              schedules your tasks into your calendar. Say goodbye to manual planning and 
              hello to optimized productivity.
            </p>
          </BCard>

          <!-- Key Features Section -->
          <BCard class="feature-card mb-4">
            <div class="card-icon">🎯</div>
            <h2 class="card-title">Key Features</h2>
            <div class="features-grid">
              <div class="feature-item">
                <div class="feature-icon">🔄</div>
                <h4>Auto-Scheduling</h4>
                <p>Automatically schedules tasks based on your working hours and preferences</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">📊</div>
                <h4>Smart Planning</h4>
                <p>Intelligently organizes your tasks considering deadlines and priorities</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">🔗</div>
                <h4>Calendar Sync</h4>
                <p>Seamlessly integrates with Google Calendar for unified scheduling</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">⏱️</div>
                <h4>Time Tracking</h4>
                <p>Break large tasks into manageable chunks with customizable durations</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">🔁</div>
                <h4>Recurring Tasks</h4>
                <p>Support for daily, weekly, monthly, and yearly repeating tasks</p>
              </div>
              <div class="feature-item">
                <div class="feature-icon">💼</div>
                <h4>Work-Life Balance</h4>
                <p>Respects your working hours and personal time boundaries</p>
              </div>
            </div>
          </BCard>

          <!-- How it Works Section -->
          <BCard class="feature-card mb-4">
            <div class="card-icon">⚙️</div>
            <h2 class="card-title">How It Works</h2>
            <div class="steps-container">
              <div class="step-item">
                <div class="step-number">1</div>
                <div class="step-content">
                  <h4>Set Your Schedule</h4>
                  <p>Configure your working hours and available days</p>
                </div>
              </div>
              <div class="step-item">
                <div class="step-number">2</div>
                <div class="step-content">
                  <h4>Add Your Tasks</h4>
                  <p>Create tasks with deadlines, priorities, and durations</p>
                </div>
              </div>
              <div class="step-item">
                <div class="step-number">3</div>
                <div class="step-content">
                  <h4>Let It Schedule</h4>
                  <p>AutoTaskCalendar automatically organizes your tasks</p>
                </div>
              </div>
              <div class="step-item">
                <div class="step-number">4</div>
                <div class="step-content">
                  <h4>Stay Synced</h4>
                  <p>View and manage everything in your calendar</p>
                </div>
              </div>
            </div>
          </BCard>

          <!-- Get Started Section -->
          <div class="cta-section">
            <h2 class="cta-title">Ready to Get Started?</h2>
            <p class="cta-text">
              Join AutoTaskCalendar today and experience effortless task management
            </p>
            <div class="cta-buttons">
              <BButton 
                variant="primary" 
                size="lg"
                to="/register"
                class="cta-button"
              >
                <span class="button-icon">🚀</span>
                Get Started
              </BButton>
              <BButton 
                variant="outline-primary" 
                size="lg"
                to="/login"
                class="cta-button"
              >
                <span class="button-icon">👤</span>
                Sign In
              </BButton>
            </div>
          </div>
        </BCol>
      </BRow>
    </BContainer>
  </div>
</template>

<script>
import { BContainer, BRow, BCol, BCard, BButton } from 'bootstrap-vue-next';

export default {
  name: "About",
  components: {
    BContainer,
    BRow,
    BCol,
    BCard,
    BButton
  },
  mounted: function () {
    this.$gtag.pageview(this.$route);
  },
  metaInfo: {
    title: "About - Smart Task Management Features",
    meta: [
      {
        name: "description",
        content: "Learn about AutoTaskCalendar's intelligent task scheduling features: automatic scheduling, Google Calendar sync, recurring tasks, task chunking, and smart planning based on your working hours.",
      },
      { 
        name: "keywords", 
        content: "task management features, calendar integration, auto-scheduling, recurring tasks, task chunking, work-life balance, productivity features" 
      },
      { property: "og:title", content: "About AutoTaskCalendar - Smart Task Management Features" },
      { 
        property: "og:description", 
        content: "Discover how AutoTaskCalendar's intelligent scheduling helps you manage tasks efficiently with automatic planning and calendar integration." 
      },
      { name: "twitter:title", content: "About AutoTaskCalendar - Smart Task Management Features" },
      { 
        name: "twitter:description", 
        content: "Discover how AutoTaskCalendar's intelligent scheduling helps you manage tasks efficiently with automatic planning and calendar integration." 
      },
    ],
  },
};
</script>


<style scoped>
.about-hero {
  text-align: center;
  padding: 60px 20px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border-radius: 20px;
  margin-bottom: 48px;
}

.hero-icon {
  font-size: 5rem;
  margin-bottom: 20px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
}

.hero-title {
  font-size: 3rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 16px;
}

.hero-subtitle {
  font-size: 1.3rem;
  color: #a0a0a0;
  margin: 0;
}

.content-section {
  margin-bottom: 40px;
}

.feature-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  transition: all 0.3s ease;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  border-color: rgba(102, 126, 234, 0.3);
}

.card-icon {
  font-size: 3rem;
  margin-bottom: 20px;
  text-align: center;
}

.card-title {
  font-size: 1.8rem;
  font-weight: 600;
  color: #e0e0e0;
  text-align: center;
  margin-bottom: 20px;
}

.card-text {
  font-size: 1.1rem;
  color: #b0b0b0;
  line-height: 1.6;
  text-align: center;
  max-width: 800px;
  margin: 0 auto;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 24px;
  margin-top: 32px;
}

.feature-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  transition: all 0.3s ease;
}

.feature-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(102, 126, 234, 0.4);
  transform: translateY(-4px);
}

.feature-icon {
  font-size: 2.5rem;
  margin-bottom: 16px;
}

.feature-item h4 {
  font-size: 1.2rem;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 12px;
}

.feature-item p {
  font-size: 0.95rem;
  color: #a0a0a0;
  line-height: 1.5;
  margin: 0;
}

.steps-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-top: 32px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 24px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
  transition: all 0.3s ease;
}

.step-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(102, 126, 234, 0.4);
  transform: translateX(8px);
}

.step-number {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  font-weight: 700;
  color: white;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.step-content {
  flex: 1;
  text-align: left;
}

.step-content h4 {
  font-size: 1.3rem;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 8px;
}

.step-content p {
  font-size: 1rem;
  color: #a0a0a0;
  margin: 0;
}

.cta-section {
  text-align: center;
  padding: 60px 32px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%);
  border-radius: 20px;
  border: 2px solid rgba(102, 126, 234, 0.2);
  margin-top: 40px;
}

.cta-title {
  font-size: 2.2rem;
  font-weight: 700;
  color: #e0e0e0;
  margin-bottom: 16px;
}

.cta-text {
  font-size: 1.2rem;
  color: #b0b0b0;
  margin-bottom: 32px;
}

.cta-buttons {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}

.cta-button {
  padding: 14px 40px;
  font-size: 1.1rem;
  border-radius: 12px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.cta-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
}

.button-icon {
  margin-right: 8px;
  font-style: normal;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .hero-title {
    font-size: 2rem;
  }

  .hero-subtitle {
    font-size: 1.1rem;
  }

  .features-grid {
    grid-template-columns: 1fr;
  }

  .step-item {
    flex-direction: column;
    text-align: center;
  }

  .step-content {
    text-align: center;
  }

  .cta-buttons {
    flex-direction: column;
    align-items: stretch;
  }

  .cta-button {
    width: 100%;
  }
}
</style>