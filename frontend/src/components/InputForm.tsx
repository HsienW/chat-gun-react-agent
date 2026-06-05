import { useState } from 'react';
import {
  Bot,
  Brain,
  Calculator,
  Cpu,
  MessageCircle,
  Search,
  Send,
  SquarePen,
  StopCircle,
  Wrench,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getAgentById } from '@/lib/agents';
import { isValidModelId } from '@/lib/models';
import { AVAILABLE_AGENTS, AgentId } from '@/types/agents';
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@/types/models';

interface InputFormProps {
  onSubmit: (
    inputValue: string,
    effort: string,
    model: string,
    agentId: string
  ) => void;
  onCancel: () => void;
  isLoading: boolean;
  hasHistory: boolean;
  selectedAgent: string;
  onAgentChange: (agentId: string) => void;
}

export const InputForm: React.FC<InputFormProps> = ({
  onSubmit,
  onCancel,
  isLoading,
  hasHistory,
  selectedAgent,
  onAgentChange,
}) => {
  const [internalInputValue, setInternalInputValue] = useState('');
  const [effort, setEffort] = useState('medium');
  const [model, setModel] = useState(DEFAULT_MODEL);

  const handleInternalSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!internalInputValue.trim()) return;
    onSubmit(internalInputValue, effort, model, selectedAgent);
    setInternalInputValue('');
  };

  const handleModelChange = (value: string) => {
    if (isValidModelId(value)) {
      setModel(value);
    }
  };

  const handleInternalKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleInternalSubmit();
    }
  };

  const isSubmitDisabled = !internalInputValue.trim() || isLoading;
  const selectedAgentInfo = getAgentById(selectedAgent);
  const showEffortSelector = selectedAgent === AgentId.DEEP_RESEARCHER;

  const getAgentIcon = (iconName: string) => {
    switch (iconName) {
      case 'search':
        return <Search className="h-4 w-4 mr-2" />;
      case 'message-circle':
        return <MessageCircle className="h-4 w-4 mr-2" />;
      case 'calculator':
        return <Calculator className="h-4 w-4 mr-2" />;
      case 'wrench':
        return <Wrench className="h-4 w-4 mr-2" />;
      default:
        return <Bot className="h-4 w-4 mr-2" />;
    }
  };

  const getModelIcon = (iconName: string, iconColor: string) => {
    switch (iconName) {
      case 'zap':
        return <Zap className={`h-4 w-4 mr-2 ${iconColor}`} />;
      case 'cpu':
        return <Cpu className={`h-4 w-4 mr-2 ${iconColor}`} />;
      default:
        return <Cpu className="h-4 w-4 mr-2 text-[#E7D9C1]" />;
    }
  };

  const controlClass =
    'flex flex-row gap-2 bg-card/90 border border-border text-[#E7D9C1] rounded-xl rounded-t-sm pl-2 max-w-[100%] sm:max-w-[90%] shadow-sm';
  const selectContentClass =
    'bg-card border-border text-[#E7D9C1] cursor-pointer';
  const selectItemClass =
    'hover:bg-[#7A1E1E]/25 focus:bg-[#7A1E1E]/25 cursor-pointer';

  return (
    <form onSubmit={handleInternalSubmit} className="flex flex-col gap-2 p-3">
      {selectedAgentInfo && (
        <div className="flex items-center gap-2 text-xs text-[#E7D9C1]/70 px-2">
          <Bot className="h-3 w-3" />
          使用 {selectedAgentInfo.name}: {selectedAgentInfo.description}
        </div>
      )}

      <div
        className={`flex flex-row items-center justify-between rounded-3xl rounded-bl-sm ${
          hasHistory ? 'rounded-br-sm' : ''
        } min-h-7 bg-card/95 border border-border px-4 pt-3 text-[#F8F1E7] shadow-lg shadow-black/10`}
      >
        <Textarea
          value={internalInputValue}
          onChange={(event) => setInternalInputValue(event.target.value)}
          onKeyDown={handleInternalKeyDown}
          placeholder="輸入你的問題..."
          className="w-full resize-none border-0 bg-transparent text-[#F8F1E7] placeholder:text-[#E7D9C1]/45 focus:outline-none focus:ring-0 focus-visible:ring-0 shadow-none md:text-base min-h-[56px] max-h-[200px]"
          rows={1}
        />
        <div className="-mt-3">
          {isLoading ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-[#E7D9C1] hover:text-white hover:bg-[#7A1E1E]/25 p-2 cursor-pointer rounded-full transition-all duration-200"
              onClick={onCancel}
            >
              <StopCircle className="h-5 w-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="ghost"
              className={`${
                isSubmitDisabled
                  ? 'text-[#E7D9C1]/35'
                  : 'text-[#E7D9C1] hover:text-white hover:bg-[#7A1E1E]/25'
              } p-2 cursor-pointer rounded-full transition-all duration-200 text-base`}
              disabled={isSubmitDisabled}
            >
              <Send className="h-5 w-5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-row flex-wrap gap-2">
          {!hasHistory && (
            <div className={controlClass}>
              <div className="flex flex-row items-center text-sm">
                <Bot className="h-4 w-4 mr-2" />
                Agent
              </div>
              <Select value={selectedAgent} onValueChange={onAgentChange}>
                <SelectTrigger className="w-[150px] bg-transparent border-none cursor-pointer">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent className={selectContentClass}>
                  {AVAILABLE_AGENTS.map((agent) => (
                    <SelectItem
                      key={agent.id}
                      value={agent.id}
                      className={selectItemClass}
                    >
                      <div className="flex items-center">
                        {getAgentIcon(agent.icon)}
                        {agent.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showEffortSelector && !hasHistory && (
            <div className={controlClass}>
              <div className="flex flex-row items-center text-sm">
                <Brain className="h-4 w-4 mr-2" />
                Effort
              </div>
              <Select value={effort} onValueChange={setEffort}>
                <SelectTrigger className="w-[120px] bg-transparent border-none cursor-pointer">
                  <SelectValue placeholder="Effort" />
                </SelectTrigger>
                <SelectContent className={selectContentClass}>
                  <SelectItem value="low" className={selectItemClass}>
                    低
                  </SelectItem>
                  <SelectItem value="medium" className={selectItemClass}>
                    中
                  </SelectItem>
                  <SelectItem value="high" className={selectItemClass}>
                    高
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className={controlClass}>
            <div className="flex flex-row items-center text-sm ml-2">
              <Cpu className="h-4 w-4 mr-2" />
              Model
            </div>
            <Select value={model} onValueChange={handleModelChange}>
              <SelectTrigger className="w-[150px] bg-transparent border-none cursor-pointer">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent className={selectContentClass}>
                {AVAILABLE_MODELS.map((modelInfo) => (
                  <SelectItem
                    key={modelInfo.id}
                    value={modelInfo.id}
                    className={selectItemClass}
                  >
                    <div className="flex items-center">
                      {getModelIcon(modelInfo.icon, modelInfo.iconColor)}
                      {modelInfo.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {hasHistory && (
          <Button
            className="bg-card border border-border text-[#E7D9C1] hover:bg-[#7A1E1E]/25 cursor-pointer rounded-xl rounded-t-sm"
            variant="default"
            onClick={() => window.location.reload()}
          >
            <SquarePen size={16} />
            新對話
          </Button>
        )}
      </div>
    </form>
  );
};
