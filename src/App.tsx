import { useEffect, useState } from 'react';
import { Editor } from './ui/Editor';
import { Output } from './ui/Output';

const isOutputHash = () => location.hash === '#output';

export function App() {
  const [output, setOutput] = useState(isOutputHash());
  useEffect(() => {
    const onHash = () => setOutput(isOutputHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return output ? <Output /> : <Editor />;
}
