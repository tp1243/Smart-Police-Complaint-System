import './App.css'
import './support.css'
import LandingHeader from './components/LandingHeader'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import Features from './components/Features'
import HowItWorks from './components/HowItWorks'
import Stats from './components/Stats'
import Testimonials from './components/Testimonials'
import About from './components/About'
import Contact from './components/Contact'
import Footer from './components/Footer'
import FloatingSiren from './components/FloatingSiren'
import UserDashboard from './pages/UserDashboard'
import ProfileSettings from './pages/ProfileSettings'
import PoliceDashboard from './pages/PoliceDashboard'
import PoliceLogin from './pages/PoliceLogin'
import PoliceRegister from './pages/PoliceRegister'
import Login from './pages/Login'
import Register from './pages/Register'
import { Routes, Route } from 'react-router-dom'

function LandingPage() {
  return (
    <div className="landing">
      {/* Show full Navbar on desktop; hide on mobile */}
      <div className="show-desktop">
        <Navbar />
      </div>
      {/* Show simplified header only on mobile */}
      <div className="show-mobile">
        <LandingHeader />
      </div>
      <Hero />
      <Features />
      <HowItWorks />
      <Stats />
      <Testimonials />
      <About />
      <Contact />
      <Footer />
      <FloatingSiren />
    </div>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/user" element={<UserDashboard />} />
      <Route path="/police/login" element={<PoliceLogin />} />
      <Route path="/police/register" element={<PoliceRegister />} />
      <Route path="/police/dashboard" element={<PoliceDashboard />} />
      <Route path="/dashboard" element={<UserDashboard />} />
      <Route path="/profile-settings" element={<ProfileSettings />} />
    </Routes>
  )
}

export default App;
