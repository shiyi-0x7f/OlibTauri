import { Link, useLocation } from 'react-router-dom';
import { Search, Download, BookOpen, Settings, LogIn, Sparkles, History } from 'lucide-react';

const Sidebar = () => {
  const location = useLocation();

  const navItems = [
    { path: '/login', icon: LogIn, label: 'Login' },
    { path: '/search', icon: Search, label: 'Search' },
    { path: '/discover', icon: Sparkles, label: 'Discover' },
    { path: '/history', icon: History, label: 'History' },
    { path: '/downloads', icon: Download, label: 'Downloads' },
    { path: '/bookshelf', icon: BookOpen, label: 'Bookshelf' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <aside className="w-64 bg-surface border-r border-border flex flex-col">
      <div className="p-6 border-b border-border">
        <h1 className="text-2xl font-bold text-primary">Olib·开源图书</h1>
        <p className="text-sm text-text-secondary mt-1">Z-Library Client</p>
      </div>

      <nav className="flex-1 p-4 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              id={item.path === '/downloads' ? 'sidebar-downloads-link' : undefined}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-all ${isActive
                  ? 'bg-primary text-white shadow-glow'
                  : 'text-text-secondary hover:bg-surface-light hover:text-text'
                }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <p className="text-xs text-text-secondary text-center">
          Version 3.1.1
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
