import { pickStat, scoreline, winnerSide } from './utils.mjs';

function favoriteBySignal(match, enrichment = {}) {
  if (enrichment?.expectation?.publicLean === 'home') return { side: 'home', source: 'webhook' };
  if (enrichment?.expectation?.publicLean === 'away') return { side: 'away', source: 'webhook' };

  let homeScore = 0;
  let awayScore = 0;
  const reasons = [];

  const homeRank = match?.detail?.ranks?.home ?? match?.homeTeam?.rank ?? null;
  const awayRank = match?.detail?.ranks?.away ?? match?.awayTeam?.rank ?? null;
  if (homeRank && awayRank && Math.abs(homeRank - awayRank) >= 3) {
    if (homeRank < awayRank) {
      homeScore += 2;
      reasons.push('排名');
    } else {
      awayScore += 2;
      reasons.push('排名');
    }
  }

  const homeValue = match?.detail?.marketValue?.home;
  const awayValue = match?.detail?.marketValue?.away;
  if (homeValue && awayValue) {
    const ratio = homeValue > awayValue ? homeValue / awayValue : awayValue / homeValue;
    if (ratio >= 1.25) {
      if (homeValue > awayValue) homeScore += ratio >= 1.6 ? 2 : 1;
      else awayScore += ratio >= 1.6 ? 2 : 1;
      reasons.push('身价');
    }
  }

  if (homeScore === awayScore) return { side: 'neutral', source: 'heuristic', reasons };
  return {
    side: homeScore > awayScore ? 'home' : 'away',
    source: 'heuristic',
    reasons,
  };
}

function outcomeAlignment(match, enrichment) {
  const favorite = favoriteBySignal(match, enrichment);
  const winner = winnerSide(match.score);
  if (favorite.side === 'neutral') {
    return {
      level: 'neutral',
      favoriteSide: favorite.side,
      summary: '赛前外界倾向并不算单边，结果更多取决于临场执行。',
      source: favorite.source,
      reasons: favorite.reasons || [],
    };
  }
  if (winner === favorite.side) {
    return {
      level: 'aligned',
      favoriteSide: favorite.side,
      summary: '赛果整体仍在主流预期范围内，但兑现方式并不完全轻松。',
      source: favorite.source,
      reasons: favorite.reasons || [],
    };
  }
  if (winner === 'draw') {
    return {
      level: 'mixed',
      favoriteSide: favorite.side,
      summary: '结果没有完全兑现主流预期，优势一方只打出了部分场面内容。',
      source: favorite.source,
      reasons: favorite.reasons || [],
    };
  }
  return {
    level: 'against',
    favoriteSide: favorite.side,
    summary: '赛果与多数人的赛前想象存在偏差，强势一方没把纸面优势转成结果。',
    source: favorite.source,
    reasons: favorite.reasons || [],
  };
}

function teamSide(match, side) {
  return side === 'home' ? match.homeTeam : match.awayTeam;
}

function losingSide(match) {
  const winner = winnerSide(match.score);
  if (winner === 'draw') return 'draw';
  return winner === 'home' ? 'away' : 'home';
}

function halfState(match) {
  const home = match.score?.halfHome ?? 0;
  const away = match.score?.halfAway ?? 0;
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

function storySignals(match) {
  const winner = winnerSide(match.score);
  const loser = losingSide(match);
  const shots = pickStat(match.detail.stats, '射门');
  const shotsOnTarget = pickStat(match.detail.stats, '射正');
  const possession = pickStat(match.detail.stats, '控球率');
  const bigChances = pickStat(match.detail.stats, '绝佳机会');
  const woodwork = pickStat(match.detail.stats, '击中门框');
  const xg = pickStat(match.detail.stats, '预期进球(xG)');

  const winnerShots = winner === 'home' ? shots.home : shots.away;
  const loserShots = winner === 'home' ? shots.away : shots.home;
  const winnerOnTarget = winner === 'home' ? shotsOnTarget.home : shotsOnTarget.away;
  const loserOnTarget = winner === 'home' ? shotsOnTarget.away : shotsOnTarget.home;
  const winnerPossession = winner === 'home' ? possession.home : possession.away;
  const loserPossession = winner === 'home' ? possession.away : possession.home;
  const winnerBigChances = winner === 'home' ? bigChances.home : bigChances.away;
  const loserBigChances = winner === 'home' ? bigChances.away : bigChances.home;
  const loserWoodwork = winner === 'home' ? woodwork.away : woodwork.home;
  const winnerXg = winner === 'home' ? xg.home : xg.away;
  const loserXg = winner === 'home' ? xg.away : xg.home;

  const halfWinner = halfState(match);
  const cameBack = winner !== 'draw' && halfWinner !== 'draw' && halfWinner !== winner;
  const lateBreak = winner !== 'draw' && halfWinner === 'draw';
  const cleanSheet = winner !== 'draw' && (winner === 'home' ? match.score.away : match.score.home) === 0;
  const efficientWin = winner !== 'draw'
    && ((winnerShots !== null && loserShots !== null && winnerShots <= loserShots)
      || (winnerOnTarget !== null && loserOnTarget !== null && winnerOnTarget < loserOnTarget)
      || (winnerXg !== null && loserXg !== null && winnerXg < loserXg));
  const underPressure = winner !== 'draw'
    && ((loserPossession !== null && loserPossession >= 55)
      || (loserShots !== null && winnerShots !== null && loserShots - winnerShots >= 4)
      || (loserBigChances !== null && winnerBigChances !== null && loserBigChances > winnerBigChances)
      || (loserWoodwork !== null && loserWoodwork >= 1));

  return {
    winner,
    loser,
    cameBack,
    lateBreak,
    cleanSheet,
    efficientWin,
    underPressure,
    shots,
    shotsOnTarget,
    possession,
    bigChances,
    woodwork,
    xg,
  };
}

function titleSuffix(match, alignment, story) {
  const winner = story.winner;
  if (winner === 'draw') return '场面拉扯到最后仍未分胜负';
  const winnerName = teamSide(match, winner).name;
  if (story.cameBack) return `${winnerName.replace(/足球俱乐部$/, '')}后程连续发力完成逆转`;
  if (story.efficientWin && alignment.level === 'against') return `${winnerName.replace(/足球俱乐部$/, '')}靠效率掌握节奏`;
  if (story.efficientWin && story.underPressure) return `${winnerName.replace(/足球俱乐部$/, '')}靠效率掌握节奏`;
  if (alignment.level === 'against') return `${winnerName.replace(/足球俱乐部$/, '')}把冷门打成了结果`;
  if (story.cleanSheet) return `${winnerName.replace(/足球俱乐部$/, '')}先手到位后稳住局面`;
  if (story.lateBreak) return `${winnerName.replace(/足球俱乐部$/, '')}后程把优势兑现成胜势`;
  return `${winnerName.replace(/足球俱乐部$/, '')}把比赛主动权握在手里`;
}

function trimSentence(value) {
  return String(value || '').replace(/[。.!！?？]+$/u, '');
}

function recapFlow(match, story) {
  const home = match.homeTeam.name;
  const away = match.awayTeam.name;
  const halfWinner = halfState(match);
  if (story.winner === 'draw') {
    return `${home}与${away}鏖战至终场仍未分出高下，半场${match.score.halfHome}-${match.score.halfAway}，全场${scoreline(match.score)}。`;
  }
  if (story.cameBack) {
    return `${teamSide(match, story.winner).name}在半场不占优的情况下，下半场连续把握关键回合，最终以${scoreline(match.score)}翻盘。`;
  }
  if (halfWinner === story.winner && (story.winner === 'home' ? match.score.home - match.score.halfHome : match.score.away - match.score.halfAway) > 0) {
    return `${teamSide(match, story.winner).name}上半场先手到位，后程又补上一击，最终以${scoreline(match.score)}收下比赛。`;
  }
  if (halfWinner === 'draw') {
    return `双方上半场互相试探，胜负在后程才被拉开，${teamSide(match, story.winner).name}最终以${scoreline(match.score)}拿下结果。`;
  }
  return `${teamSide(match, story.winner).name}始终把比分主动权握在手里，最终以${scoreline(match.score)}击败${teamSide(match, story.loser).name}。`;
}

function statSentence(match, story) {
  const loser = story.loser;
  if (loser === 'draw') return '';
  const loserName = teamSide(match, loser).name;
  const possession = story.possession;
  const shots = story.shots;
  const shotsOnTarget = story.shotsOnTarget;
  const bigChances = story.bigChances;
  const woodwork = story.woodwork;

  const pieces = [];
  const loserPossession = loser === 'home' ? possession.home : possession.away;
  const loserShots = loser === 'home' ? shots.home : shots.away;
  const winnerShots = loser === 'home' ? shots.away : shots.home;
  const loserOnTarget = loser === 'home' ? shotsOnTarget.home : shotsOnTarget.away;
  const winnerOnTarget = loser === 'home' ? shotsOnTarget.away : shotsOnTarget.home;
  const loserBig = loser === 'home' ? bigChances.home : bigChances.away;
  const winnerBig = loser === 'home' ? bigChances.away : bigChances.home;
  const loserWood = loser === 'home' ? woodwork.home : woodwork.away;

  if (loserPossession !== null) pieces.push(`${loserName}控球${loserPossession}%`);
  if (loserShots !== null && winnerShots !== null) pieces.push(`射门${loserShots}比${winnerShots}`);
  if (loserOnTarget !== null && winnerOnTarget !== null) pieces.push(`射正${loserOnTarget}比${winnerOnTarget}`);
  if (loserBig !== null && winnerBig !== null && (loserBig + winnerBig) > 0) pieces.push(`绝佳机会${loserBig}比${winnerBig}`);
  if (loserWood !== null && loserWood > 0) pieces.push(`还有${loserWood}次击中门框`);
  if (!pieces.length) return '';

  return `从数据看，${pieces.join('、')}，场面并不算完全被压制。`;
}

function reviewSentence(match, alignment, story, enrichment) {
  const winner = story.winner;
  if (winner === 'draw') {
    return `${trimSentence(alignment.summary)}。双方更像是在互相限制而非持续压上，临门一脚和禁区内的处理都没能把场面差异真正放大。`;
  }

  const winnerName = teamSide(match, winner).name;
  const loserName = teamSide(match, story.loser).name;
  const intro = enrichment?.expectation?.note
    ? enrichment.expectation.note
    : alignment.summary;

  if (story.efficientWin && story.underPressure) {
    return `${trimSentence(intro)}。${winnerName}赢在先手和终结效率，领先后把比赛拖进自己熟悉的节奏；${loserName}虽然数据不差，但高质量机会没能连续兑现。`;
  }
  if (story.cameBack) {
    return `${trimSentence(intro)}。${winnerName}的价值体现在后程调整和禁区冲击，比分落后后没有乱节奏，反而把对手的防守波动持续放大。`;
  }
  if (alignment.level === 'against') {
    return `${trimSentence(intro)}。${winnerName}把有限的优势回合做成了结果，反倒是${loserName}在领先预期或场面基础上没能把握住关键节点。`;
  }
  if (story.cleanSheet) {
    return `${trimSentence(intro)}。${winnerName}一旦拿到先手，比赛管理能力就比较稳定，防线没有给${loserName}连续冲击同一区域的空间。`;
  }
  return `${trimSentence(intro)}。${winnerName}在关键时段的执行力更完整，尤其是禁区内处理和比赛节奏切换，比${loserName}更接近成熟赢球的一方。`;
}

function articleImage(match, enrichment) {
  if (enrichment?.image?.url) {
    return {
      status: 'ready',
      url: enrichment.image.url,
      alt: enrichment.image.alt || `${match.homeTeam.name} vs ${match.awayTeam.name} 比赛过程图`,
      source: enrichment.image.source || 'official-social',
      postUrl: enrichment.image.postUrl || '',
      caption: enrichment.image.caption || '',
    };
  }
  return {
    status: 'pending',
    url: '',
    alt: `${match.homeTeam.name} vs ${match.awayTeam.name} 官方社媒过程图待补充`,
    source: 'pending-webhook',
    postUrl: '',
    caption: '等待 webhook 注入官方社媒比赛过程图。',
  };
}

export function hydrateMatch(match, enrichment = {}, styleGuide = {}) {
  const story = storySignals(match);
  const alignment = outcomeAlignment(match, enrichment);
  const recap = `${recapFlow(match, story)}${statSentence(match, story)}`.trim();
  const review = reviewSentence(match, alignment, story, enrichment).trim();
  const title = `${match.tagCode}：${match.homeTeam.name}${scoreline(match.score)}${match.awayTeam.name}：${titleSuffix(match, alignment, story)}`;

  return {
    ...match,
    enrichment,
    expectation: alignment,
    image: articleImage(match, enrichment),
    article: {
      title,
      recap,
      review,
      format: ['标题', '回顾赛果', '配图', '复盘'],
      styleProfile: styleGuide?.profile || 'jingcai_result_rag_v1',
    },
  };
}
