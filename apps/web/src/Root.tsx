import App from './App';
import PatternDemo from './PatternDemo';

export default function Root() {
  return window.location.pathname === '/demo' || window.location.pathname === '/demo/'
    ? <PatternDemo />
    : <App />;
}
