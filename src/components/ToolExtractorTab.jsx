import ExtractorApp from '../../tool-extractor.tsx';
import { extractorToTool } from '../schema/toolSchema.js';

export default function ToolExtractorTab({ onExtract }) {
  const handleExtract = (extractorData) => {
    const tool = extractorToTool(extractorData);
    onExtract(tool);
  };

  return (
    <div style={{ margin: '0 -20px' }}>
      <ExtractorApp onExtract={handleExtract} />
    </div>
  );
}
