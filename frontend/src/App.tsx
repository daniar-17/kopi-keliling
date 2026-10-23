import { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import MerchantPage from './pages/MerchantPage'

// Routing sederhana berbasis hash: #/pedagang membuka area pedagang.
function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash)

  useEffect(function listenHashChange() {
    const handleHashChange = () => setRoute(window.location.hash)

    window.addEventListener('hashchange', handleHashChange)

    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return route
}

function App() {
  const route = useHashRoute()

  if (route.startsWith('#/pedagang')) {
    return <MerchantPage />
  }

  return <HomePage />
}

export default App
