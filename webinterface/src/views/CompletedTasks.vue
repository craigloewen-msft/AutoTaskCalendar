<template>
  <div class="completed-tasks-page">
    <BContainer class="mt-4">
      <div class="page-header mb-4">
        <h1 class="page-title">
          <i class="bi bi-check-circle-fill"></i>
          Completed Tasks
        </h1>
        <p class="text-muted">Review all your accomplished tasks</p>
      </div>

      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>

      <div v-else-if="completedTasks.length === 0" class="empty-state text-center py-5">
        <i class="bi bi-inbox display-1 text-muted"></i>
        <h3 class="mt-3">No completed tasks yet</h3>
        <p class="text-muted">Complete some tasks and they'll appear here!</p>
        <router-link to="/user" class="btn btn-primary mt-3">
          Go to Tasks
        </router-link>
      </div>

      <div v-else>
        <div class="filters mb-4">
          <BRow>
            <BCol md="6">
              <BFormInput
                v-model="searchQuery"
                placeholder="Search completed tasks..."
                class="search-input"
              />
            </BCol>
            <BCol md="6">
              <BFormSelect v-model="sortBy" :options="sortOptions" class="sort-select" />
            </BCol>
          </BRow>
        </div>

        <div class="tasks-grid">
          <div
            v-for="task in filteredAndSortedTasks"
            :key="task._id"
            class="task-card"
          >
            <div class="task-card-header">
              <h5 class="task-title">
                <i class="bi bi-check-circle-fill text-success"></i>
                {{ task.title }}
              </h5>
              <span v-if="task.repeat" class="badge bg-info">
                <i class="bi bi-arrow-repeat"></i>
                {{ task.repeat }}
              </span>
            </div>

            <div class="task-card-body">
              <p v-if="task.notes" class="task-notes">{{ task.notes }}</p>

              <div class="task-meta">
                <div class="meta-item">
                  <i class="bi bi-calendar-check"></i>
                  <span>Completed: {{ formatDate(task.completedDate) }}</span>
                </div>
                <div v-if="task.dueDate" class="meta-item">
                  <i class="bi bi-calendar-event"></i>
                  <span>Due: {{ formatDate(task.dueDate) }}</span>
                </div>
                <div class="meta-item">
                  <i class="bi bi-clock"></i>
                  <span>Duration: {{ task.duration }} mins</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredAndSortedTasks.length === 0" class="text-center py-5">
          <p class="text-muted">No tasks match your search.</p>
        </div>

        <!-- Load More Button -->
        <div v-if="hasMore && !isSearching" class="text-center mt-4">
          <button 
            class="btn btn-primary load-more-btn" 
            @click="loadMoreTasks"
            :disabled="loadingMore"
          >
            <span v-if="loadingMore">
              <span class="spinner-border spinner-border-sm me-2" role="status"></span>
              Loading...
            </span>
            <span v-else>
              <i class="bi bi-arrow-down-circle me-2"></i>
              Load More ({{ totalCount - currentSkip }} remaining)
            </span>
          </button>
        </div>

        <!-- Task count info -->
        <div v-if="!isSearching" class="text-center mt-3">
          <small class="text-muted">
            Showing {{ completedTasks.length }} of {{ totalCount }} completed tasks
          </small>
        </div>
        <div v-else class="text-center mt-3">
          <small class="text-muted">
            Found {{ completedTasks.length }} tasks matching "{{ searchQuery }}"
          </small>
        </div>
      </div>
    </BContainer>
  </div>
</template>

<script>
import { BContainer, BRow, BCol, BFormInput, BFormSelect } from 'bootstrap-vue-next';

export default {
  name: 'CompletedTasks',
  components: {
    BContainer,
    BRow,
    BCol,
    BFormInput,
    BFormSelect
  },
  data() {
    return {
      completedTasks: [],
      loading: true,
      loadingMore: false,
      searchQuery: '',
      sortBy: 'completedDate',
      sortOptions: [
        { value: 'completedDate', text: 'Recently Completed' },
        { value: 'title', text: 'Title (A-Z)' },
        { value: 'duration', text: 'Duration' },
        { value: 'dueDate', text: 'Due Date' }
      ],
      currentSkip: 0,
      pageSize: 20,
      totalCount: 0,
      hasMore: false,
      isSearching: false
    };
  },
  computed: {
    filteredAndSortedTasks() {
      let tasks = this.completedTasks;

      // Sort tasks (filtering is done by search now)
      tasks = [...tasks].sort((a, b) => {
        switch (this.sortBy) {
          case 'completedDate':
            return new Date(b.completedDate) - new Date(a.completedDate);
          case 'title':
            return a.title.localeCompare(b.title);
          case 'duration':
            return (b.duration || 0) - (a.duration || 0);
          case 'dueDate':
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(b.dueDate) - new Date(a.dueDate);
          default:
            return 0;
        }
      });

      return tasks;
    }
  },
  mounted() {
    this.fetchCompletedTasks();
  },
  watch: {
    searchQuery(newValue) {
      // Debounce the search
      if (this.searchTimeout) {
        clearTimeout(this.searchTimeout);
      }
      this.searchTimeout = setTimeout(() => {
        this.handleSearch();
      }, 500);
    }
  },
  methods: {
    async fetchCompletedTasks(loadMore = false) {
      if (loadMore) {
        this.loadingMore = true;
      } else {
        this.loading = true;
        this.currentSkip = 0;
        this.completedTasks = [];
      }

      try {
        const response = await this.$http.get('/api/getCompletedTasks', {
          params: {
            limit: this.pageSize,
            skip: this.currentSkip
          }
        });

        if (response.data.success) {
          if (loadMore) {
            this.completedTasks = [...this.completedTasks, ...(response.data.taskList || [])];
          } else {
            this.completedTasks = response.data.taskList || [];
          }
          this.totalCount = response.data.totalCount || 0;
          this.hasMore = response.data.hasMore || false;
          this.currentSkip += (response.data.taskList || []).length;
          this.isSearching = false;
        }
      } catch (error) {
        console.error('Error fetching completed tasks:', error);
      } finally {
        this.loading = false;
        this.loadingMore = false;
      }
    },
    async handleSearch() {
      if (!this.searchQuery || this.searchQuery.trim() === '') {
        // Reset to normal pagination if search is cleared
        this.fetchCompletedTasks();
        return;
      }

      this.loading = true;
      this.isSearching = true;

      try {
        const response = await this.$http.get('/api/searchCompletedTasks', {
          params: {
            q: this.searchQuery
          }
        });

        if (response.data.success) {
          this.completedTasks = response.data.taskList || [];
          this.hasMore = false; // No load more for search results
        }
      } catch (error) {
        console.error('Error searching completed tasks:', error);
      } finally {
        this.loading = false;
      }
    },
    loadMoreTasks() {
      if (!this.loadingMore && this.hasMore) {
        this.fetchCompletedTasks(true);
      }
    },
    formatDate(dateString) {
      if (!dateString) return 'N/A';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
  },
  metaInfo: {
    title: 'Completed Tasks'
  }
};
</script>

<style scoped>
.completed-tasks-page {
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
  color: #10b981;
  -webkit-text-fill-color: #10b981;
}

.filters {
  background: rgba(255, 255, 255, 0.05);
  padding: 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.search-input,
.sort-select {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  border-radius: 8px;
}

.search-input:focus,
.sort-select:focus {
  background: rgba(255, 255, 255, 0.1);
  border-color: #667eea;
  color: #e0e0e0;
}

.tasks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.task-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.3s ease;
  backdrop-filter: blur(10px);
}

.task-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(102, 126, 234, 0.2);
  border-color: rgba(102, 126, 234, 0.3);
}

.task-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.task-title {
  font-size: 1.2rem;
  font-weight: 600;
  color: #e0e0e0;
  margin: 0;
  flex: 1;
}

.task-title i {
  margin-right: 10px;
  font-size: 1.1rem;
}

.badge {
  font-size: 0.75rem;
  padding: 4px 8px;
  border-radius: 6px;
}

.task-card-body {
  color: #b0b0b0;
}

.task-notes {
  font-size: 0.9rem;
  margin-bottom: 15px;
  color: #c0c0c0;
  line-height: 1.5;
}

.task-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meta-item {
  display: flex;
  align-items: center;
  font-size: 0.85rem;
  color: #a0a0a0;
}

.meta-item i {
  margin-right: 8px;
  color: #667eea;
  font-size: 1rem;
}

.empty-state {
  color: #b0b0b0;
}

.empty-state i {
  opacity: 0.3;
}

.spinner-border {
  width: 3rem;
  height: 3rem;
}

.load-more-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  padding: 12px 30px;
  font-size: 1rem;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.load-more-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .tasks-grid {
    grid-template-columns: 1fr;
  }

  .page-title {
    font-size: 2rem;
  }
}
</style>
