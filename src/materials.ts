export type Sentence = {
  id: string
  text: string
}

export type Issue = {
  sentenceId: string
  comment: string
}

export type Premise = {
  id: string
  label: string
  coveredIn: Array<1 | 2>
}

export type ReportQuote = {
  sentenceId: string
  note: string
}

export type ReportDimension = {
  score: number
  summary: string
  quotes: ReportQuote[]
}

export type Report = {
  match: ReportDimension & {
    covered: string
    missed: string
    wrong: string
  }
  logic: ReportDimension & {
    order: string
    skipped: string
    premises: string
  }
  fluency: ReportDimension & {
    fillers: Array<{ word: string; count: number }>
    repetition: string
    corrections: string
  }
}

export type Material = {
  id: string
  title: string
  kind: string
  length: string
  summary: string
  context: string
  listener: string
  paragraphs: string[]
  premises: Premise[]
  attempt1: Sentence[]
  attempt2: Sentence[]
  feedback1: {
    understood: string
    issues: Issue[]
  }
  feedback2: {
    improved: string
    improvedSentenceId: string
    stillSentenceId: string
    still: string
  }
  report1: Report
  report2: Report
}

export const materials: Material[] = [
  {
    id: "meeting",
    title: "周四的客户会改到线上",
    kind: "工作转告",
    length: "大约一分钟",
    summary: "把一条刚收到的客户会变更，转告给没在场的同事。",
    context: "讲给没参加过星河物流对接、刚来两周的新同事听。他等一下要去找王磊，把变更转告过去。",
    listener: "刚来两周的新同事",
    paragraphs: [
      "产品组原定周四下午两点，在三楼会议室和星河物流对接排期。对方刚来消息：他们上海办公室周四全员远程，人不在北京。",
      "会改成线上，还是两点开始，但只留四十分钟。请王磊带上最新的交付清单，尤其是「仓储接口」那一项——对方说这一项如果周四定不下来，下周三的联调就要往后推一周。",
      "另外，三楼会议室可以释放，不用占着。",
    ],
    premises: [
      {
        id: "who",
        label: "这场会是产品组和星河物流对接排期",
        coveredIn: [2],
      },
      {
        id: "place",
        label: "原来约在三楼会议室，因为对方上海办公室周四全员远程才改成线上",
        coveredIn: [2],
      },
      {
        id: "stakes",
        label: "仓储接口如果周四定不下来，下周三的联调要往后推一周",
        coveredIn: [2],
      },
    ],
    attempt1: [
      { id: "m-a1", text: "嗯，就是那个，周四的会，现在改成线上了。" },
      { id: "m-a2", text: "对方说他们周四人都远程。" },
      { id: "m-a3", text: "还是两点。" },
      { id: "m-a4", text: "然后王磊要带交付清单。" },
      { id: "m-a5", text: "哦对，会议室可以释放掉，不用占着了。" },
      { id: "m-a6", text: "就是……基本上就这些。" },
    ],
    feedback1: {
      understood: "周四的会改成线上，开始时间还是两点。王磊要带交付清单。会议室可以释放。",
      issues: [
        {
          sentenceId: "m-a1",
          comment:
            "等等，这是跟谁开的会？我只听到「周四的会改成线上了」。我来了才两周，不知道对方是哪家，对的是什么。你后面又说会议室可以释放——原来不是在会议室开吗？我没听清一开始在哪儿开，也不知道为啥改成线上。让我去转告王磊，开口第一句就会卡住。",
        },
        {
          sentenceId: "m-a4",
          comment:
            "我听懂王磊要带清单。可清单如果很长，我该特别叮嘱哪一项？不定下来会怎样？这些你没讲。我现在去找他，只会说「带上清单」，那件真正不能漏的事，我传不出去。",
        },
      ],
    },
    attempt2: [
      { id: "m-b1", text: "周四下午两点的客户会，改成线上了。" },
      { id: "m-b2", text: "地点不再是三楼会议室。" },
      { id: "m-b3", text: "星河物流周四全员远程，人不在北京。" },
      { id: "m-b4", text: "还是两点开始。" },
      {
        id: "m-b5",
        text: "王磊要带最新的交付清单，里面仓储接口这一项，如果周四定不下来，下周三的联调就要往后推一周。",
      },
      { id: "m-b6", text: "三楼会议室可以释放。" },
    ],
    feedback2: {
      improved:
        "上一遍我不知道这是跟谁开的会，也不知道清单里哪一项不能漏。这遍你讲到了：是和星河物流对接排期，仓储接口如果周四定不下来，下周三的联调要推一周——这个我可以转告王磊了。原来在三楼开、因为人不在北京才改线上，我也听清了。",
      improvedSentenceId: "m-b5",
      stillSentenceId: "m-b4",
      still: "这场会现在有多长，我还是不清楚。你说还是两点开始，没有说只留四十分钟。我要是去帮王磊排议程，不知道要不要把内容砍短。",
    },
    report1: {
      match: {
        score: 54,
        covered: "讲到了会改成线上、开始时间还是两点、王磊要带交付清单、会议室可以释放。",
        missed: "没讲这是和星河物流对接排期的会，没讲仓储接口与联调的后果，也没讲只留四十分钟。",
        wrong: "没有讲错的事实，主要是漏。",
        summary: "变更本身讲到了，但这场会是什么会、哪一项不能漏，新同事听完还是拼不起来。",
        quotes: [
          {
            sentenceId: "m-a1",
            note: "开口就是「周四的会」，没交代是和谁、对什么。",
          },
          {
            sentenceId: "m-a4",
            note: "只说「带交付清单」，没有仓储接口，也没有定不下来会怎样。",
          },
        ],
      },
      logic: {
        score: 48,
        order: "先说改成线上，再说对方远程、还是两点、带清单，最后补一句会议室可以释放。",
        skipped: "释放会议室出现时，前面没有说过原来在会议室开，听众要自己补这一步。",
        premises: "三个前提都跳过了：跟谁开、原来在哪开、清单里哪一项有后果。",
        summary: "听起来像在对已经知道这场会的人说话。新同事缺的那些背景，没有先放下。",
        quotes: [
          {
            sentenceId: "m-a5",
            note: "「会议室可以释放」突然出现，前面没有「原来在三楼开」。",
          },
        ],
      },
      fluency: {
        score: 66,
        fillers: [
          { word: "嗯", count: 1 },
          { word: "那个", count: 1 },
          { word: "就是", count: 2 },
        ],
        repetition: "没有整句重复。",
        corrections: "「哦对」是说到后来才补上会议室那句，有一次改口。",
        summary: "能听完，但口头禅和补一句，让这段话听起来像边想边说。",
        quotes: [
          {
            sentenceId: "m-a1",
            note: "开头「嗯，就是那个」占去一句里一半的位置。",
          },
          {
            sentenceId: "m-a6",
            note: "结尾「就是……基本上就这些」，没有把话收住。",
          },
        ],
      },
    },
    report2: {
      match: {
        score: 86,
        covered: "补上了星河物流、人不在北京、原来在三楼、仓储接口以及联调要推一周。改成线上、两点、释放会议室，这些也还在。",
        missed: "仍没有讲这场会只留四十分钟。",
        wrong: "没有讲错的事实。",
        summary: "要点基本讲全了。还缺的是时长，不是这场会是什么。",
        quotes: [
          {
            sentenceId: "m-b5",
            note: "仓储接口和联调后果这一句，把上一遍传不出去的事补上了。",
          },
          {
            sentenceId: "m-b4",
            note: "仍只说「还是两点开始」，没有四十分钟。",
          },
        ],
      },
      logic: {
        score: 84,
        order: "先说变更，再说地点和原因，然后是王磊要做的事，最后释放会议室。顺序清楚。",
        skipped: "时长这一步仍被跳过。",
        premises: "三个前提这遍都交代了。",
        summary: "新同事不再需要自己补「这是什么会」。剩下的缺口在细节，不在前提。",
        quotes: [
          {
            sentenceId: "m-b3",
            note: "在说释放会议室之前，先讲清了是星河物流、人为何改线上。",
          },
        ],
      },
      fluency: {
        score: 92,
        fillers: [],
        repetition: "没有重复。",
        corrections: "没有说到一半改口。",
        summary: "句子干脆，几乎没有口头禅。",
        quotes: [
          {
            sentenceId: "m-b1",
            note: "开头直接进入「周四下午两点的客户会」，不再用「嗯，就是那个」起势。",
          },
        ],
      },
    },
  },
  {
    id: "gym",
    title: "这周先不续健身房",
    kind: "日常决定",
    length: "大约一分钟",
    summary: "讲清楚这周为什么不续健身房。",
    context: "讲给一起办过卡的朋友听。他知道你一直在这家店，也知道续三个月有八折，刚才还劝你趁折扣续上。",
    listener: "一起办过卡的朋友",
    paragraphs: [
      "我办的是月卡，这周五到期。本来想直接续三个月，店里续三个月有八折。",
      "但这周开始要出差，下周一到周四在杭州，健身房用不上。而且膝盖上个月扭过，医生说这两周尽量不跑、不深蹲，只做拉伸。",
      "所以这周先不续。等下下周回北京、膝盖也缓过来，再办月卡，不办季卡——因为后面可能还会出差，季卡浪费的天数更多。",
    ],
    premises: [
      {
        id: "trip",
        label: "下周一到周四在杭州出差，这周用不上健身房",
        coveredIn: [1, 2],
      },
      {
        id: "knee",
        label: "膝盖上个月扭过，医生说这两周不跑、不深蹲，只做拉伸",
        coveredIn: [2],
      },
      {
        id: "later",
        label: "后面可能还会出差，所以等回北京再办月卡，不办季卡",
        coveredIn: [],
      },
    ],
    attempt1: [
      { id: "g-a1", text: "嗯，我这周不续健身房了。" },
      { id: "g-a2", text: "卡是这周五到期。" },
      { id: "g-a3", text: "本来店里续三个月有折扣，但是我下周要出差，去杭州，用不上。" },
      { id: "g-a4", text: "所以就先不续了。" },
      { id: "g-a5", text: "以后再办一个月的，不办那么长的。" },
      { id: "g-a6", text: "大概就是这样。" },
    ],
    feedback1: {
      understood: "月卡这周五到期。因为下周去杭州出差，健身房用不上，所以这周不续。你之后打算办短一点的，不办那么长。",
      issues: [
        {
          sentenceId: "g-a3",
          comment:
            "等等，就因为去杭州几天，连八折也不续了？我刚才还劝你趁折扣办三个月。膝盖的事你完全没提：医生说这两周不跑、不深蹲，只做拉伸。就算人没去杭州，这周也练不了什么。我现在听到的理由只有出差，会以为你下周回来就能续。",
        },
        {
          sentenceId: "g-a5",
          comment:
            "「以后」是什么时候，我没跟上。你也没讲为什么要放弃三个月的八折：后面可能还会出差，季卡空掉的天数更多。别人要是再劝你趁打折办长的，我帮你挡不住。",
        },
      ],
    },
    attempt2: [
      { id: "g-b1", text: "健身房月卡这周五到期，我这周先不续。" },
      { id: "g-b2", text: "下周一到周四我在杭州出差，人用不上。" },
      {
        id: "g-b3",
        text: "另外膝盖上个月扭了，医生说这两周不跑、不深蹲，只做拉伸，所以就算在北京也先别练。",
      },
      { id: "g-b4", text: "等下下周回北京，膝盖缓过来，再办一个月的。" },
      { id: "g-b5", text: "不办三个月。" },
      { id: "g-b6", text: "店里的折扣我就先不看了。" },
    ],
    feedback2: {
      improved:
        "膝盖这件事这遍我听到了。医生让这两周只做拉伸，再加上杭州出差，所以这周不续——这个因果我跟上了。下下周回北京再办月卡，时间也清楚了。我不至于再以为你下周回来就能续。",
      improvedSentenceId: "g-b3",
      stillSentenceId: "g-b6",
      still: "为什么放弃八折，我还是没跟上。你说折扣先不看，没有讲后面可能还会出差，季卡空掉的天数更多。如果再有人劝你趁打折办长的，我替你回答不上来。",
    },
    report1: {
      match: {
        score: 60,
        covered: "讲到了月卡周五到期、下周去杭州出差所以用不上、这周先不续、以后办短的。",
        missed: "没讲膝盖和医生的限制，没讲下下周回北京再办，也没讲为什么不办季卡。",
        wrong: "没有讲错的事实。",
        summary: "「不续」这个决定讲到了，劝你续卡的朋友最在意的那两个理由，还缺一个半。",
        quotes: [
          {
            sentenceId: "g-a3",
            note: "理由收成了出差，膝盖完全没有出现。",
          },
          {
            sentenceId: "g-a5",
            note: "「以后再办一个月的」没有时间，也没有不办季卡的原因。",
          },
        ],
      },
      logic: {
        score: 58,
        order: "先说不续和到期，再说出差，然后收住。顺序本身不乱。",
        skipped: "从「用不上」直接跳到「先不续」，中间没有「就算在北京也练不了」。",
        premises: "出差这一层有了；膝盖、以及为什么不办季卡，都跳过了。",
        summary: "对已经知道有八折的朋友来说，只拿出差解释「不续」，因果偏薄。",
        quotes: [
          {
            sentenceId: "g-a4",
            note: "「所以就先不续了」接在出差后面，听起来出差是唯一原因。",
          },
        ],
      },
      fluency: {
        score: 72,
        fillers: [
          { word: "嗯", count: 1 },
          { word: "就是", count: 1 },
        ],
        repetition: "「不续」说了两回，意思没有推进。",
        corrections: "没有明显改口。",
        summary: "大体顺，开头和收尾还有口头禅。",
        quotes: [
          {
            sentenceId: "g-a1",
            note: "以「嗯」起头。",
          },
          {
            sentenceId: "g-a6",
            note: "「大概就是这样」把话松开了。",
          },
        ],
      },
    },
    report2: {
      match: {
        score: 82,
        covered: "补上了膝盖和医生的限制、下周一到周四在杭州、下下周回北京再办月卡。到期、不续，这些也还在。",
        missed: "仍没有讲后面可能还会出差，所以不办季卡。",
        wrong: "没有讲错的事实。",
        summary: "这周不续的理由完整了。还缺的是「为什么不办三个月」。",
        quotes: [
          {
            sentenceId: "g-b3",
            note: "膝盖和拉伸这一句，补上了上一遍没有的理由。",
          },
          {
            sentenceId: "g-b6",
            note: "「折扣先不看了」没有解释为什么放弃八折。",
          },
        ],
      },
      logic: {
        score: 80,
        order: "先说决定，再说出差和膝盖，然后是何时再办。因果清楚。",
        skipped: "从「不办三个月」跳到「折扣先不看」，中间缺「后面可能还会出差」。",
        premises: "出差和膝盖都交代了；不办季卡的那条还缺。",
        summary: "朋友可以理解这周为什么不续，还是不好帮你挡住「趁打折办长的」。",
        quotes: [
          {
            sentenceId: "g-b4",
            note: "「等下下周回北京」把「以后」落成了时间。",
          },
        ],
      },
      fluency: {
        score: 90,
        fillers: [],
        repetition: "没有重复。",
        corrections: "没有改口。",
        summary: "句子干净，几乎没有口头禅。",
        quotes: [
          {
            sentenceId: "g-b1",
            note: "开头直接说到期和不续，不再用「嗯」垫一句。",
          },
        ],
      },
    },
  },
  {
    id: "projector",
    title: "便携投影仪这周先别借",
    kind: "事实经过",
    length: "大约一分钟",
    summary: "讲清楚投影仪出了什么事，以及这周该怎么办。",
    context: "讲给隔壁组来借投影仪的同事听。他只知道你们组有台便携的能外借，不知道上周市场部汇报出了什么事。",
    listener: "隔壁组来借投影仪的同事",
    paragraphs: [
      "上周三下午，市场部在一楼多功能厅对客户做季度汇报，借用了我们组的便携投影仪。会开到一半，画面突然偏黄，然后灭了。",
      "他们换了自己的备用线，还是不行。最后是前台从库房找出一台旧的台式投影，才把剩下的二十分钟讲完。",
      "周四早上，小陈把我们那台拿去检修，发现是灯泡寿命到了，不是线的问题。维修点说灯泡要订，大概五天到。所以这周如果谁要外接投影，别再借那台便携的，用一楼库房那台旧的，或者提前跟行政说。",
    ],
    premises: [
      {
        id: "incident",
        label: "上周三市场部对客户汇报时，这台便携投影用到一半灭了，换备用线也不行",
        coveredIn: [1, 2],
      },
      {
        id: "fallback",
        label: "这周可以用一楼库房那台旧的台式投影，或者提前跟行政说",
        coveredIn: [2],
      },
      {
        id: "timing",
        label: "是灯泡寿命到了，不是线的问题，灯泡大概五天到",
        coveredIn: [],
      },
    ],
    attempt1: [
      { id: "p-a1", text: "就是我们那个投影仪坏了。" },
      { id: "p-a2", text: "上周市场部借去给客户汇报，放到一半就灭了。" },
      { id: "p-a3", text: "他们以为是线，换了线也不行。" },
      { id: "p-a4", text: "后来小陈拿去修，说是灯泡的问题，要订货。" },
      { id: "p-a5", text: "所以这周先别借了。" },
      { id: "p-a6", text: "嗯，先这样。" },
    ],
    feedback1: {
      understood:
        "你们的投影仪坏了。上周市场部借去给客户汇报，放到一半灭了，换线也没用。小陈拿去修，是灯泡的问题，要订货。这周先别借。",
      issues: [
        {
          sentenceId: "p-a5",
          comment:
            "等等，这周完全没得用了吗？上次他们后来是怎么把会开完的，你没讲。我只听到「先别借」，不知道能不能用一楼库房那台旧的，也不知道可以提前找行政。我这周也有场要外接投影的会，现在只能空手回去。",
        },
        {
          sentenceId: "p-a4",
          comment:
            "要订货——大概多久能回来？是灯泡寿命到了，不是线的问题，维修点说大概五天到。这些你没说完。我周四那场还能不能指望这台，我现在答不上。",
        },
      ],
    },
    attempt2: [
      { id: "p-b1", text: "我们组那台便携投影仪坏了，这周别借。" },
      { id: "p-b2", text: "上周三市场部在一楼给客户做汇报，用到一半灭了。" },
      { id: "p-b3", text: "换了备用线还是不行。" },
      { id: "p-b4", text: "最后是前台从一楼库房找了台旧的台式投影，才把剩下的会讲完。" },
      { id: "p-b5", text: "小陈周四拿去修，是灯泡坏了，不是线。" },
      { id: "p-b6", text: "所以这周要用投影的话，用库房那台旧的，或者提前跟行政说。" },
    ],
    feedback2: {
      improved:
        "上一遍我不知道「别借了用什么」。这遍你讲了：用一楼库房那台旧的台式投影，或者提前跟行政说。这个我能带走了。换线没用、是灯泡不是线，我也听清了。",
      improvedSentenceId: "p-b6",
      stillSentenceId: "p-b5",
      still: "灯泡什么时候能回来，我还是不清楚。你说是灯泡坏了，没有说要订、大概五天到。如果有人问我这周四能不能用回那台便携的，我答不上。",
    },
    report1: {
      match: {
        score: 58,
        covered: "讲到了投影仪坏了、上周市场部借去汇报时灭了、换线不行、灯泡要订货、这周别借。",
        missed: "没讲可以改用库房那台旧的或找行政，也没讲灯泡大概五天到。",
        wrong: "没有讲错的事实。",
        summary: "「别借」讲到了，来借的人最需要的下文——用什么、多久能回来——还没有。",
        quotes: [
          {
            sentenceId: "p-a5",
            note: "在「所以这周先别借了」收住，没有替代办法。",
          },
          {
            sentenceId: "p-a4",
            note: "「要订货」没有说到大概五天。",
          },
        ],
      },
      logic: {
        score: 56,
        order: "先说坏了，再补上周发生的事，然后是检修和「别借」。经过本身清楚。",
        skipped: "从「要订货」直接跳到「别借」，中间没有「这周用什么」。",
        premises: "出事经过有了；替代方案、以及五天这个时间，都跳过了。",
        summary: "对来借的同事来说，故事听完了，下一步没有。",
        quotes: [
          {
            sentenceId: "p-a5",
            note: "结论停在「别借」，没有把上次是靠库房那台才开完会这一点接上。",
          },
        ],
      },
      fluency: {
        score: 70,
        fillers: [
          { word: "就是", count: 1 },
          { word: "嗯", count: 1 },
        ],
        repetition: "没有整句重复。",
        corrections: "没有明显改口。",
        summary: "能听完，开头和收尾仍有垫话。",
        quotes: [
          {
            sentenceId: "p-a1",
            note: "「就是我们那个投影仪坏了」，用「就是」起头，也没说是哪一台便携的。",
          },
          {
            sentenceId: "p-a6",
            note: "「嗯，先这样」把话收得过早。",
          },
        ],
      },
    },
    report2: {
      match: {
        score: 84,
        covered: "补上了库房那台旧的台式投影、可以提前跟行政说、换线不行、是灯泡不是线。出事经过也更具体了。",
        missed: "仍没有讲灯泡要订、大概五天到。",
        wrong: "没有讲错的事实。",
        summary: "这周怎么做已经能带走。还缺的是那台便携的何时能回来。",
        quotes: [
          {
            sentenceId: "p-b6",
            note: "替代办法这一句，把上一遍的缺口补上了。",
          },
          {
            sentenceId: "p-b5",
            note: "「是灯泡坏了，不是线」仍没有五天。",
          },
        ],
      },
      logic: {
        score: 82,
        order: "先说别借，再讲上周怎么灭的、后来用了库房那台，然后是检修结果和这周怎么办。顺序清楚。",
        skipped: "检修结果停在「不是线」，没有把「五天到」接上。",
        premises: "出事经过和替代方案都交代了；五天这条还缺。",
        summary: "来借的人知道这周用什么了，还是没法判断周四能不能用回便携的那台。",
        quotes: [
          {
            sentenceId: "p-b4",
            note: "在给结论之前，先讲了上次是靠库房那台把会开完的。",
          },
        ],
      },
      fluency: {
        score: 91,
        fillers: [],
        repetition: "没有重复。",
        corrections: "没有改口。",
        summary: "句子干脆，几乎没有口头禅。",
        quotes: [
          {
            sentenceId: "p-b1",
            note: "开头直接说是便携投影仪、这周别借，不再用「就是」垫。",
          },
        ],
      },
    },
  },
]

export function getMaterial(id: string): Material | undefined {
  return materials.find((item) => item.id === id)
}

export function premisesFor(material: Material, attempt: 1 | 2) {
  return material.premises.map((premise) => ({
    ...premise,
    covered: premise.coveredIn.includes(attempt),
  }))
}
