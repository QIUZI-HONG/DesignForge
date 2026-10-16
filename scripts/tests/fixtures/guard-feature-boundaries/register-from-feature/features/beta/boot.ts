// 违规夹具③：feature 引他 feature 的 register——ADR-0004 ②「feature 之间禁引」（只允许 app/** 引）。
import { AlphaBootstrap } from '@/features/alpha/register';

export const betaBoot = AlphaBootstrap;
