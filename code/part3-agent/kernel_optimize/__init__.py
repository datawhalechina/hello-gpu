"""kernel_optimize：教学用的 agentic 算子优化 agent。

一个简单可读的 Reflection/ReAct loop（agent.py）+ 一组工具（tools.py），
把「算子优化闭环」讲清楚、跑通。设计原则：
LLM 自由发挥地驱动闭环、选策略、多轮对话；确定性工具掌权「真假」。
"""

from .agent import run_agent

__all__ = ["run_agent"]
