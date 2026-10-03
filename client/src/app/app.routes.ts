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
  {
    path: 'new-article',
    loadComponent: () =>
      import('./pages/article-create/article-create').then((module) => module.ArticleCreate),
    title: 'Hummingbird | New article',
  },
  {
    path: 'articles/:slug',
    loadComponent: () =>
      import('./pages/article-detail/article-detail').then((module) => module.ArticleDetail),
    title: 'Hummingbird | Article',
  },
  { path: '**', component: NotFound, title: 'Hummingbird | Page not found' },
];
