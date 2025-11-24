<template>
  <div class="statistics-page">
    <BContainer class="mt-4">
      <div class="page-header mb-4">
        <h1 class="page-title">
          <i class="bi bi-graph-up"></i>
          Productivity Statistics
        </h1>
        <p class="text-muted">Track your progress and productivity over time</p>
      </div>

      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else>
        <!-- Summary Cards -->
        <BRow class="mb-4">
          <BCol md="3" sm="6" class="mb-3">
            <div class="stat-card">
              <div class="stat-icon bg-success">
                <i class="bi bi-check-circle-fill"></i>
              </div>
              <div class="stat-content">
                <h3>{{ statistics.completedTasksCount }}</h3>
                <p>Completed Tasks</p>
              </div>
            </div>
          </BCol>

          <BCol md="3" sm="6" class="mb-3">
            <div class="stat-card">
              <div class="stat-icon bg-warning">
                <i class="bi bi-hourglass-split"></i>
              </div>
              <div class="stat-content">
                <h3>{{ statistics.incompleteTasksCount }}</h3>
                <p>Active Tasks</p>
              </div>
            </div>
          </BCol>

          <BCol md="3" sm="6" class="mb-3">
            <div class="stat-card">
              <div class="stat-icon bg-info">
                <i class="bi bi-clock-history"></i>
              </div>
              <div class="stat-content">
                <h3>{{ statistics.totalTimeSpent }}</h3>
                <p>Total Minutes</p>
              </div>
            </div>
          </BCol>

          <BCol md="3" sm="6" class="mb-3">
            <div class="stat-card">
              <div class="stat-icon bg-primary">
                <i class="bi bi-speedometer2"></i>
              </div>
              <div class="stat-content">
                <h3>{{ Math.round(statistics.avgTaskDuration) }}</h3>
                <p>Avg. Duration (min)</p>
              </div>
            </div>
          </BCol>
        </BRow>

        <!-- Charts Row -->
        <BRow class="mb-4">
          <BCol lg="8" class="mb-4">
            <div class="chart-card">
              <h4 class="chart-title">
                <i class="bi bi-graph-up-arrow"></i>
                Tasks Completed Over Time
              </h4>
              <LineChart :data="lineChartData" :options="lineChartOptions" />
            </div>
          </BCol>

          <BCol lg="4" class="mb-4">
            <div class="chart-card">
              <h4 class="chart-title">
                <i class="bi bi-pie-chart-fill"></i>
                Task Status
              </h4>
              <Doughnut :data="doughnutChartData" :options="doughnutChartOptions" />
            </div>
          </BCol>
        </BRow>

        <!-- Bar Chart Row -->
        <BRow>
          <BCol lg="12" class="mb-4">
            <div class="chart-card">
              <h4 class="chart-title">
                <i class="bi bi-bar-chart-fill"></i>
                Task Breakdown
              </h4>
              <Bar :data="barChartData" :options="barChartOptions" />
            </div>
          </BCol>
        </BRow>

        <!-- Additional Stats -->
        <BRow>
          <BCol md="6" class="mb-4">
            <div class="info-card">
              <h5><i class="bi bi-list-task"></i> Task Types</h5>
              <div class="info-content">
                <div class="info-item">
                  <span>Regular Tasks:</span>
                  <strong>{{ statistics.regularTasks }}</strong>
                </div>
                <div class="info-item">
                  <span>Backlog Tasks:</span>
                  <strong>{{ statistics.backlogTasks }}</strong>
                </div>
                <div class="info-item">
                  <span>Repeating Tasks:</span>
                  <strong>{{ statistics.repeatingTasks }}</strong>
                </div>
              </div>
            </div>
          </BCol>

          <BCol md="6" class="mb-4">
            <div class="info-card">
              <h5><i class="bi bi-trophy-fill"></i> Achievements</h5>
              <div class="info-content">
                <div class="achievement-item">
                  <i class="bi bi-star-fill text-warning"></i>
                  <span v-if="statistics.completedTasksCount >= 100">Century Club - 100+ tasks completed!</span>
                  <span v-else-if="statistics.completedTasksCount >= 50">Half Century - 50+ tasks completed!</span>
                  <span v-else-if="statistics.completedTasksCount >= 10">Getting Started - 10+ tasks completed!</span>
                  <span v-else>Complete more tasks to unlock achievements!</span>
                </div>
                <div class="achievement-item">
                  <i class="bi bi-lightning-fill text-warning"></i>
                  <span v-if="statistics.totalTimeSpent >= 6000">Time Master - 6000+ minutes invested!</span>
                  <span v-else-if="statistics.totalTimeSpent >= 3000">Time Warrior - 3000+ minutes invested!</span>
                  <span v-else>Keep working to unlock more achievements!</span>
                </div>
              </div>
            </div>
          </BCol>
        </BRow>
      </div>
    </BContainer>
  </div>
</template>

<script>
import { BContainer, BRow, BCol } from 'bootstrap-vue-next';
import { Line as LineChart, Doughnut, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default {
  name: 'Statistics',
  components: {
    BContainer,
    BRow,
    BCol,
    LineChart,
    Doughnut,
    Bar
  },
  data() {
    return {
      loading: true,
      statistics: {
        totalTasks: 0,
        completedTasksCount: 0,
        incompleteTasksCount: 0,
        tasksByDay: {},
        totalTimeSpent: 0,
        avgTaskDuration: 0,
        regularTasks: 0,
        backlogTasks: 0,
        repeatingTasks: 0
      }
    };
  },
  computed: {
    lineChartData() {
      const tasksByDay = this.statistics.tasksByDay || {};
      const sortedDates = Object.keys(tasksByDay).sort();
      const last30Days = sortedDates.slice(-30);

      return {
        labels: last30Days.map(date => {
          const d = new Date(date);
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [
          {
            label: 'Tasks Completed',
            data: last30Days.map(date => tasksByDay[date]),
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.2)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
          }
        ]
      };
    },
    lineChartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#e0e0e0'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff'
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#b0b0b0'
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#b0b0b0',
              stepSize: 1
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      };
    },
    doughnutChartData() {
      return {
        labels: ['Completed', 'Active'],
        datasets: [
          {
            data: [this.statistics.completedTasksCount, this.statistics.incompleteTasksCount],
            backgroundColor: ['#10b981', '#f59e0b'],
            borderColor: ['rgba(16, 185, 129, 0.8)', 'rgba(245, 158, 11, 0.8)'],
            borderWidth: 2
          }
        ]
      };
    },
    doughnutChartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#e0e0e0',
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff'
          }
        }
      };
    },
    barChartData() {
      return {
        labels: ['Regular', 'Backlog', 'Repeating'],
        datasets: [
          {
            label: 'Task Count',
            data: [
              this.statistics.regularTasks,
              this.statistics.backlogTasks,
              this.statistics.repeatingTasks
            ],
            backgroundColor: [
              'rgba(102, 126, 234, 0.8)',
              'rgba(245, 158, 11, 0.8)',
              'rgba(59, 130, 246, 0.8)'
            ],
            borderColor: [
              'rgba(102, 126, 234, 1)',
              'rgba(245, 158, 11, 1)',
              'rgba(59, 130, 246, 1)'
            ],
            borderWidth: 2
          }
        ]
      };
    },
    barChartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            labels: {
              color: '#e0e0e0'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff'
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#b0b0b0'
            },
            grid: {
              display: false
            }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#b0b0b0',
              stepSize: 1
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          }
        }
      };
    }
  },
  mounted() {
    this.fetchStatistics();
  },
  methods: {
    async fetchStatistics() {
      this.loading = true;
      try {
        const response = await this.$http.get('/api/getTaskStatistics');
        if (response.data.success) {
          this.statistics = response.data.statistics;
        }
      } catch (error) {
        console.error('Error fetching statistics:', error);
      } finally {
        this.loading = false;
      }
    }
  },
  metaInfo: {
    title: 'Statistics'
  }
};
</script>

<style scoped>
.statistics-page {
  min-height: 80vh;
  background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
  padding-bottom: 50px;
}

.page-header {
  text-align: center;
  padding: 30px 0;
}

.page-title {
  font-size: 2.5rem;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 10px;
}

.page-title i {
  margin-right: 15px;
  color: #667eea;
  -webkit-text-fill-color: #667eea;
}

.stat-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 15px;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
  height: 100%;
}

.stat-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
}

.stat-icon {
  width: 60px;
  height: 60px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: white;
}

.bg-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.bg-warning {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}

.bg-info {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
}

.bg-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.stat-content h3 {
  font-size: 2rem;
  font-weight: 700;
  color: #e0e0e0;
  margin: 0;
}

.stat-content p {
  font-size: 0.9rem;
  color: #b0b0b0;
  margin: 0;
}

.chart-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 25px;
  backdrop-filter: blur(10px);
  height: 100%;
}

.chart-title {
  color: #e0e0e0;
  font-size: 1.2rem;
  font-weight: 600;
  margin-bottom: 20px;
}

.chart-title i {
  margin-right: 10px;
  color: #667eea;
}

.info-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 25px;
  backdrop-filter: blur(10px);
  height: 100%;
}

.info-card h5 {
  color: #e0e0e0;
  font-size: 1.2rem;
  font-weight: 600;
  margin-bottom: 20px;
}

.info-card h5 i {
  margin-right: 10px;
  color: #667eea;
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #b0b0b0;
}

.info-item:last-child {
  border-bottom: none;
}

.info-item strong {
  color: #e0e0e0;
  font-size: 1.1rem;
}

.achievement-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #b0b0b0;
}

.achievement-item:last-child {
  border-bottom: none;
}

.achievement-item i {
  font-size: 1.5rem;
}

.spinner-border {
  width: 3rem;
  height: 3rem;
}

@media (max-width: 768px) {
  .page-title {
    font-size: 2rem;
  }

  .stat-card {
    margin-bottom: 15px;
  }
}
</style>
