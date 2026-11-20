import { BrowserRouter, Route, Routes } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { ToastProvider } from './components/ToastContext'
import { AuthProvider } from './components/AuthProvider'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import './App.css'
import PoemDetailPage from './pages/PoemDetailPage'
import ProfilePage from './pages/ProfilePage'

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<PlaceholderPage pageKey="home" />} />
            <Route path="mood-entry" element={<PlaceholderPage pageKey="moodEntry" />} />
            <Route path="mood-feed" element={<PlaceholderPage pageKey="moodFeed" />} />
            <Route path="poems/:id" element={<PoemDetailPage />} />
            <Route path="write" element={<PlaceholderPage pageKey="writePoem" />} />
            <Route path="my-poems" element={<PlaceholderPage pageKey="myPoems" />} />
            <Route path="authors/:id" element={<PlaceholderPage pageKey="authorProfile" />} />
            <Route path="search" element={<PlaceholderPage pageKey="search" />} />
            <Route path="themes" element={<PlaceholderPage pageKey="themes" />} />
            <Route path="notifications" element={<PlaceholderPage pageKey="notifications" />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />
            <Route path="moderation" element={<PlaceholderPage pageKey="moderation" />} />
            <Route path="*" element={<PlaceholderPage pageKey="notFound" />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}

export default App
