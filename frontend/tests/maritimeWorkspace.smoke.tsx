// Test-only entry point: not imported by the production application.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {Auth0Context} from '@auth0/auth0-react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthenticatedApp} from '../src/App'
import {ProjectProvider} from '../src/lib/ProjectContext'
import {ThemeProvider} from '../src/lib/ThemeContext'
import {CurrentUserProvider} from '../src/lib/CurrentUserContext'
import '../src/index.css'
history.replaceState({},'', '/maritime/workspace/project')
sessionStorage.setItem('prosota_maritime_selected_project',JSON.stringify({id:'00000000-0000-4000-8000-000000000017',name:'Harbour East QA',workspace:'maritime',status:'active',org_id:'qa'}))
// ProjectContext selects its storage key at module evaluation, so use the same
// fixture in the construction key for this isolated HTML entry point as well.
sessionStorage.setItem('prosota_selected_project',sessionStorage.getItem('prosota_maritime_selected_project')!)
createRoot(document.getElementById('root')!).render(<Auth0Context.Provider value={{isAuthenticated:true,isLoading:false,user:{name:'Browser QA'},logout:async()=>{},getAccessTokenSilently:async()=>''} as any}><QueryClientProvider client={new QueryClient()}><ThemeProvider><CurrentUserProvider><ProjectProvider><AuthenticatedApp/></ProjectProvider></CurrentUserProvider></ThemeProvider></QueryClientProvider></Auth0Context.Provider>)
