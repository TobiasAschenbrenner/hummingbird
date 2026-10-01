import { Routes } from '@angular/router';

import { Home } from './pages/home/home';
import { NotFound } from './pages/not-found/not-found';

export const routes: Routes = [
  { path: '', component: Home, title: 'Hummingbird | Home' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((module) => module.Login),
    title: 'Hummingbird | Log in',
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then((module) => module.Register),
    title: 'Hummingbird | Register',
  },
  { path: '**', component: NotFound, title: 'Hummingbird | Page not found' },
];
