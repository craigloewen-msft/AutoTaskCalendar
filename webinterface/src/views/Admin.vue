<template>
  <div class="admin-page">
    <BContainer class="mt-4">
      <div class="admin-header">
        <div>
          <h1 class="page-title">Admin</h1>
          <p class="text-muted admin-subtitle">Site overview · all times UTC</p>
        </div>
        <button
          class="btn btn-outline-primary"
          type="button"
          :disabled="overviewLoading"
          @click="loadOverview"
        >
          {{ overviewLoading ? "Refreshing…" : "Refresh" }}
        </button>
      </div>

      <div v-if="overviewLoading && !overview" class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else-if="overviewError" class="empty-state text-center py-5" data-test="admin-error">
        <h3>Could not load the dashboard</h3>
        <p class="text-muted">{{ overviewError }}</p>
        <button class="btn btn-primary mt-2" type="button" @click="loadOverview">Retry</button>
      </div>

      <template v-else-if="overview">
        <section class="metric-grid" data-test="admin-overview">
          <article
            v-for="card in metricCards"
            :key="card.key"
            class="metric-card"
            :data-test="'admin-metric-' + card.key"
          >
            <p class="metric-label">{{ card.label }}</p>
            <p class="metric-value">{{ card.value }}</p>
            <p class="metric-note">{{ card.note }}</p>
          </article>
        </section>

        <section class="panel" data-test="admin-trends">
          <header class="panel-header">
            <h2 class="panel-title">Last 30 days</h2>
            <div class="legend">
              <span
                v-for="series in trendSeries"
                :key="series.key"
                class="legend-item"
              >
                <span class="legend-swatch" :class="series.key"></span>{{ series.label }}
              </span>
            </div>
          </header>

          <div class="trend-chart">
            <div
              v-for="day in overview.trends"
              :key="day.date"
              class="trend-day"
              :title="trendTitle(day)"
            >
              <span class="trend-stack">
                <span
                  v-for="series in trendSeries"
                  :key="series.key"
                  class="trend-bar"
                  :class="series.key"
                  :style="{ height: barHeight(day[series.key]) }"
                ></span>
              </span>
              <span class="trend-label">{{ dayLabel(day.date) }}</span>
            </div>
          </div>
        </section>

        <div class="panel-row">
          <section class="panel">
            <h2 class="panel-title">Engagement</h2>
            <dl class="stat-list">
              <div v-for="row in engagementRows" :key="row.label" class="stat-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </section>

          <section class="panel">
            <h2 class="panel-title">Scheduling health</h2>
            <dl class="stat-list">
              <div v-for="row in healthRows" :key="row.label" class="stat-row">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </template>

      <section class="panel" data-test="admin-user-table">
        <header class="panel-header">
          <h2 class="panel-title">Users</h2>
          <div class="table-controls">
            <input
              v-model="search"
              class="form-control"
              type="search"
              placeholder="Search username or email…"
              aria-label="Search users"
              data-test="admin-user-search"
            />
            <select v-model="sort" class="form-select" aria-label="Sort users" @change="loadUsers(1)">
              <option value="lastLogin">Last seen</option>
              <option value="created">Joined</option>
              <option value="username">Username</option>
              <option value="tasks">Tasks</option>
            </select>
          </div>
        </header>

        <p v-if="usersError" class="empty-note" data-test="admin-user-error">
          {{ usersError }}
          <button class="btn btn-sm btn-outline-primary ms-2" type="button" @click="loadUsers(page)">
            Retry
          </button>
        </p>

        <div v-else class="table-scroll">
          <table class="user-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Email</th>
                <th>Joined</th>
                <th>Last seen</th>
                <th class="numeric">Tasks</th>
                <th class="numeric">Done</th>
                <th class="numeric">Projects</th>
                <th>Google</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in users" :key="row._id" data-test="admin-user-row">
                <td>
                  {{ row.username }}
                  <span v-if="row.isAdmin" class="admin-chip">admin</span>
                </td>
                <td class="muted">{{ row.email || "—" }}</td>
                <td class="muted">{{ formatDate(row.createdAt) }}</td>
                <td class="muted">{{ formatDate(row.lastLoginDate) }}</td>
                <td class="numeric">{{ row.taskCount }}</td>
                <td class="numeric">{{ row.completedCount }}</td>
                <td class="numeric">{{ row.projectCount }}</td>
                <td class="muted">{{ row.googleConnected ? "yes" : "—" }}</td>
              </tr>
            </tbody>
          </table>

          <p v-if="!usersLoading && !users.length" class="empty-note">
            No users match that search.
          </p>
          <p v-if="usersLoading" class="empty-note">Loading…</p>
        </div>

        <footer v-if="totalPages > 1" class="pagination-row" data-test="admin-pagination">
          <button
            class="btn btn-sm btn-outline-primary"
            type="button"
            :disabled="page <= 1 || usersLoading"
            @click="loadUsers(page - 1)"
          >
            Previous
          </button>
          <span class="page-indicator">Page {{ page }} of {{ totalPages }} · {{ totalCount }} users</span>
          <button
            class="btn btn-sm btn-outline-primary"
            type="button"
            :disabled="page >= totalPages || usersLoading"
            @click="loadUsers(page + 1)"
          >
            Next
          </button>
        </footer>
      </section>
    </BContainer>
  </div>
</template>

<script>
import { BContainer } from "bootstrap-vue-next";

const TREND_SERIES = [
  { key: "signups", label: "Signups" },
  { key: "tasksCreated", label: "Tasks created" },
  { key: "tasksCompleted", label: "Tasks completed" },
];

const SEARCH_DELAY_MS = 250;

export default {
  name: "Admin",
  components: { BContainer },
  data() {
    return {
      overview: null,
      overviewLoading: false,
      overviewError: "",
      users: [],
      totalCount: 0,
      page: 1,
      limit: 25,
      sort: "lastLogin",
      search: "",
      usersLoading: false,
      usersError: "",
      trendSeries: TREND_SERIES,
      searchTimer: null,
      // Bumped per request so a slow response can never overwrite a newer one.
      usersRequest: 0,
    };
  },
  computed: {
    totalPages() {
      return Math.max(Math.ceil(this.totalCount / this.limit), 1);
    },
    metricCards() {
      if (!this.overview) return [];
      const { totals, engagement, health } = this.overview;
      return [
        {
          key: "users",
          label: "Users",
          value: this.formatNumber(totals.users),
          note: `${this.formatNumber(engagement.newUsers30)} joined in 30d`,
        },
        {
          key: "tasks",
          label: "Tasks",
          value: this.formatNumber(totals.tasks),
          note: `${this.formatNumber(totals.activeTasks)} still open`,
        },
        {
          key: "completion",
          label: "Completion rate",
          value: `${health.completionRate}%`,
          note: `${this.formatNumber(totals.completedTasks)} completed`,
        },
        {
          key: "active",
          label: "Active users",
          value: this.formatNumber(engagement.activeUsers7),
          note: "signed in over 7d",
        },
      ];
    },
    engagementRows() {
      if (!this.overview) return [];
      const { engagement, totals } = this.overview;
      return [
        { label: "New this week", value: this.formatNumber(engagement.newUsers7) },
        { label: "Active this month", value: this.formatNumber(engagement.activeUsers30) },
        { label: "Dormant (30d+)", value: this.formatNumber(engagement.dormantUsers) },
        { label: "With tasks", value: this.formatNumber(engagement.usersWithTasks) },
        { label: "Using Compass", value: this.formatNumber(engagement.usersWithCompass) },
        { label: "Committed a week", value: this.formatNumber(engagement.usersWithCommittedWeek) },
        { label: "Google connected", value: this.formatNumber(engagement.usersWithGoogle) },
        { label: "Tasks per user (median / mean)", value: `${engagement.medianTasksPerUser} / ${engagement.meanTasksPerUser}` },
        { label: "Calendar events", value: this.formatNumber(totals.events) },
      ];
    },
    healthRows() {
      if (!this.overview) return [];
      const { health, totals } = this.overview;
      return [
        { label: "Scheduled", value: this.formatNumber(health.scheduledTasks) },
        { label: "Unscheduled", value: this.formatNumber(health.unscheduledTasks) },
        { label: "Overdue", value: this.formatNumber(health.overdueTasks) },
        { label: "Backlog", value: this.formatNumber(totals.backlogTasks) },
        { label: "Linked to a project", value: this.formatNumber(health.tasksWithProject) },
        { label: "Unaligned", value: this.formatNumber(health.tasksWithoutProject) },
        { label: "Recurring series", value: this.formatNumber(totals.recurringSeries) },
        { label: "Roles / goals / projects", value: `${totals.roles} / ${totals.goals} / ${totals.projects}` },
        { label: "Committed weeks", value: this.formatNumber(totals.weeklyPlans) },
      ];
    },
    // One shared scale across all three series, so the bars stay comparable.
    trendPeak() {
      if (!this.overview) return 0;
      return this.overview.trends.reduce((peak, day) => {
        return Math.max(peak, day.signups, day.tasksCreated, day.tasksCompleted);
      }, 0);
    },
  },
  created() {
    this.loadOverview();
    this.loadUsers(1);
  },
  watch: {
    search() {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.loadUsers(1), SEARCH_DELAY_MS);
    },
  },
  beforeUnmount() {
    clearTimeout(this.searchTimer);
  },
  methods: {
    async loadOverview() {
      this.overviewLoading = true;
      this.overviewError = "";
      try {
        const response = await this.$http.get("/api/admin/overview");
        if (!response.data.success) throw new Error(response.data.log || "Request failed");
        this.overview = response.data;
      } catch (error) {
        this.overviewError = error.message || "Request failed";
      } finally {
        this.overviewLoading = false;
      }
    },
    async loadUsers(page = 1) {
      const request = ++this.usersRequest;
      this.usersLoading = true;
      this.usersError = "";
      try {
        const response = await this.$http.get("/api/admin/users", {
          params: { page, limit: this.limit, sort: this.sort, search: this.search || undefined },
        });
        if (request !== this.usersRequest) return;
        if (!response.data.success) throw new Error(response.data.log || "Request failed");
        this.users = response.data.users;
        this.totalCount = response.data.totalCount;
        this.page = response.data.page;
      } catch (error) {
        if (request !== this.usersRequest) return;
        this.usersError = error.message || "Request failed";
      } finally {
        if (request === this.usersRequest) this.usersLoading = false;
      }
    },
    barHeight(value) {
      if (!this.trendPeak || !value) return "0%";
      // A floor keeps a single-unit day visible instead of rounding away to nothing.
      return `${Math.max((value / this.trendPeak) * 100, 4)}%`;
    },
    trendTitle(day) {
      return `${day.date} · ${day.signups} signups · ${day.tasksCreated} created · ${day.tasksCompleted} completed`;
    },
    dayLabel(date) {
      return date.slice(8);
    },
    formatNumber(value) {
      return Number(value || 0).toLocaleString("en-US");
    },
    formatDate(value) {
      if (!value) return "never";
      return String(value).slice(0, 10);
    },
  },
};
</script>

<style scoped>
.admin-page {
  text-align: left;
  padding-bottom: 40px;
}

.admin-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 20px;
}

.page-title {
  font-weight: 700;
  margin-bottom: 2px;
}

.admin-subtitle {
  margin-bottom: 0;
  font-size: 0.9rem;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}

.metric-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 16px 18px;
}

.metric-label {
  margin: 0;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9aa4b2;
}

.metric-value {
  margin: 4px 0 2px;
  font-size: 2rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.metric-note {
  margin: 0;
  font-size: 0.82rem;
  color: #9aa4b2;
}

.panel {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 18px;
}

.panel-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 18px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.panel-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}

.legend {
  display: flex;
  gap: 14px;
  font-size: 0.8rem;
  color: #9aa4b2;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.legend-swatch.signups,
.trend-bar.signups {
  background: #667eea;
}

.legend-swatch.tasksCreated,
.trend-bar.tasksCreated {
  background: #3b82f6;
}

.legend-swatch.tasksCompleted,
.trend-bar.tasksCompleted {
  background: #10b981;
}

.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 150px;
}

.trend-day {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
}

.trend-stack {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 1px;
  width: 100%;
  height: 100%;
}

.trend-bar {
  width: 30%;
  border-radius: 2px 2px 0 0;
  min-height: 0;
}

.trend-label {
  font-size: 0.65rem;
  color: #6b7280;
  margin-top: 4px;
}

.stat-list {
  margin: 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.stat-row:last-child {
  border-bottom: none;
}

.stat-row dt {
  font-weight: 400;
  color: #9aa4b2;
}

.stat-row dd {
  margin: 0;
  font-weight: 600;
}

.table-controls {
  display: flex;
  gap: 8px;
}

.table-controls .form-control {
  min-width: 220px;
}

.table-scroll {
  overflow-x: auto;
}

.user-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.user-table th {
  text-align: left;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9aa4b2;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.user-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.user-table .numeric {
  text-align: right;
}

.user-table .muted {
  color: #9aa4b2;
}

.admin-chip {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 2em;
  font-size: 0.7rem;
  background: rgba(102, 126, 234, 0.2);
  color: #a5b4fc;
}

.empty-note {
  color: #9aa4b2;
  font-size: 0.9rem;
  padding: 12px 0;
  margin: 0;
}

.pagination-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 14px;
}

.page-indicator {
  font-size: 0.85rem;
  color: #9aa4b2;
}
</style>
