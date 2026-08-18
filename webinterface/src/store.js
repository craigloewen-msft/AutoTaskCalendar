import { createStore } from 'vuex'
import axios from 'axios'

for (const key of ['token', 'user', 'lastLoginDate']) localStorage.removeItem(key)
axios.defaults.withCredentials = true

let sessionCheckPromise = null

export default createStore({
    state: {
        status: '',
        user: {},
        sessionChecked: false,
    },
    mutations: {
        auth_request(state) {
            state.status = 'Loading...'
        },
        auth_success(state, user) {
            state.status = 'Success'
            state.user = user
            state.sessionChecked = true
        },
        auth_error(state) {
            state.status = 'Error'
            state.user = {}
            state.sessionChecked = true
        },
        logout(state) {
            state.status = ''
            state.user = {}
            state.sessionChecked = true
        },
        refresh_user_info(state, refreshedUser) {
            state.user = refreshedUser
        },
    },
    actions: {
        initializeSession({ commit, state }) {
            if (state.sessionChecked) return Promise.resolve(state.user)
            if (!sessionCheckPromise) {
                sessionCheckPromise = axios.get('/api/user')
                    .then((response) => {
                        if (!response.data.success) throw new Error('No active session')
                        commit('auth_success', response.data.user)
                        return response.data.user
                    })
                    .catch(() => {
                        commit('auth_error')
                        return null
                    })
                    .finally(() => {
                        sessionCheckPromise = null
                    })
            }
            return sessionCheckPromise
        },
        login({ commit }, loginData) {
            commit('auth_success', loginData.user)
            return Promise.resolve('Success!')
        },
        register({ commit }, registerData) {
            commit('auth_success', registerData.user)
            return Promise.resolve('Success!')
        },
        async logout({ commit, getters }) {
            try {
                if (getters.isLoggedIn) await axios.post('/api/logout')
            } catch (error) {
                // Local logout must still finish after an expired server session.
            } finally {
                commit('logout')
            }
        },
        clearSession({ commit }) {
            commit('logout')
        },
        refreshUserInfo({ commit }, refreshedUser) {
            commit('refresh_user_info', refreshedUser)
            return Promise.resolve()
        },
    },
    getters: {
        isLoggedIn: state => !!state.user.username,
        authStatus: state => state.status,
    },
})
